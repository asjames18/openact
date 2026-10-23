import { z } from 'zod';

/**
 * Declarative transform step. Can be a shorthand string (e.g. "trim", "extractNumber")
 * or a parameterized object (e.g. { regexExtract: "(\\d+)" }, { prefix: "https://..." }).
 */
export const TransformStepSchema = z.union([
  z.enum([
    'trim',
    'lowercase',
    'uppercase',
    'extractNumber',
    'extractFloat',
    'boolean',
    'stripHtml',
    'stripLeadingSlash',
    'stripTrailingSlash',
    'parseJson',
    'firstLine',
    'collapseWhitespace',
    'decodeUri',
    'encodeUri',
  ]),
  z.record(z.string(), z.any()),
]);

export type TransformStep = z.infer<typeof TransformStepSchema>;

/**
 * Field extraction mapping used in both HTTP (JSON path) and HTML (CSS/Hydration/JSON-LD) modes.
 */
export const FieldMappingSchema = z.union([
  z.string(), // Shorthand: CSS selector or JSON dot-path
  z.object({
    /** CSS selector (for HTML) or dot/bracket path (for JSON/Hydration/JSON-LD) */
    selector: z.string().optional(),
    path: z.string().optional(),
    /** HTML attribute to extract (e.g. "href", "src", "content"). Defaults to textContent. */
    attribute: z.string().optional(),
    /** Extract raw innerHTML instead of textContent */
    html: z.boolean().optional(),
    /** Extract all matching elements as an array */
    multiple: z.boolean().optional(),
    /** Static constant value if selector/path is omitted */
    constant: z.any().optional(),
    /** Fallback default value if extracted value is null/undefined/empty */
    default: z.any().optional(),
    /** Declarative transformation pipeline */
    transform: z.array(TransformStepSchema).optional(),
  }),
]);

export type FieldMapping = z.infer<typeof FieldMappingSchema>;

/**
 * Input parameter definition for a Blueprint.
 */
export const InputParamSchema = z.object({
  type: z.enum(['string', 'number', 'boolean']).default('string'),
  description: z.string().optional(),
  required: z.boolean().default(false),
  default: z.any().optional(),
  enum: z.array(z.string()).optional(),
});

export type InputParam = z.infer<typeof InputParamSchema>;

/**
 * HTTP Request configuration used across Tier 1 and Tier 2.
 */
export const RequestSpecSchema = z.object({
  url: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  body: z.any().optional(),
  timeoutMs: z.number().int().positive().default(15000),
});

export type RequestSpec = z.infer<typeof RequestSpecSchema>;

/**
 * Tier 1: Direct HTTP / JSON / GraphQL extraction configuration.
 */
export const HttpExecutionSpecSchema = z.object({
  responseType: z.enum(['json', 'text']).default('json'),
  /** Dot-path to the root item or array inside the JSON payload (e.g. "data.children") */
  rootPath: z.string().optional(),
  /** Whether to map over an array at rootPath */
  multiple: z.boolean().default(false),
  /** Limit maximum items returned when multiple=true */
  limit: z.number().int().positive().optional(),
  /** Declarative field mapping for each item (or root object) */
  fields: z.record(z.string(), FieldMappingSchema).optional(),
});

export type HttpExecutionSpec = z.infer<typeof HttpExecutionSpecSchema>;

/**
 * Tier 2: HTML / Hydration / JSON-LD / Metadata extraction configuration.
 */
export const ExtractExecutionSpecSchema = z.object({
  strategy: z
    .enum(['css', 'json-ld', 'hydration', 'meta', 'regex', 'auto'])
    .default('css'),
  /** Root CSS selector when strategy='css' (e.g. "article.Box-row") */
  root: z.string().optional(),
  /** Dot-path when strategy='hydration' or 'json-ld' (e.g. "props.pageProps.items") */
  rootPath: z.string().optional(),
  /** Hydration global variable or script id (defaults to auto-detecting __NEXT_DATA__, __NUXT__, etc.) */
  hydrationKey: z.string().optional(),
  /** Whether to extract a list of items */
  multiple: z.boolean().default(false),
  /** Limit maximum items returned when multiple=true */
  limit: z.number().int().positive().optional(),
  /** Field mappings */
  fields: z.record(z.string(), FieldMappingSchema).optional(),
});

export type ExtractExecutionSpec = z.infer<typeof ExtractExecutionSpecSchema>;

/**
 * Browser automation steps for Tier 3 (Playwright).
 */
export const BrowserStepSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('goto'),
    url: z.string(),
    waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  }),
  z.object({
    action: z.literal('click'),
    selector: z.string(),
    timeoutMs: z.number().int().positive().optional(),
  }),
  z.object({
    action: z.literal('fill'),
    selector: z.string(),
    value: z.string(),
  }),
  z.object({
    action: z.literal('press'),
    selector: z.string(),
    key: z.string(),
  }),
  z.object({
    action: z.literal('waitForSelector'),
    selector: z.string(),
    timeoutMs: z.number().int().positive().optional(),
  }),
  z.object({
    action: z.literal('waitMs'),
    ms: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal('evaluate'),
    expression: z.string(),
  }),
]);

export type BrowserStep = z.infer<typeof BrowserStepSchema>;

/**
 * Tier 3: Playwright Browser & Live Network Interception configuration.
 */
export const BrowserExecutionSpecSchema = z.object({
  headless: z.boolean().default(true),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).default('domcontentloaded'),
  /** Optional URL substring or regex to intercept background JSON XHR/fetch responses */
  interceptUrlPattern: z.string().optional(),
  /** Sequential browser interaction steps */
  steps: z.array(BrowserStepSchema).optional(),
  /** Extract from DOM/hydration after steps complete */
  extract: ExtractExecutionSpecSchema.optional(),
  /** Or map from an intercepted JSON response using Tier 1 JSON mapping */
  http: HttpExecutionSpecSchema.optional(),
});

export type BrowserExecutionSpec = z.infer<typeof BrowserExecutionSpecSchema>;

/**
 * Recursive Execution Spec supporting fallback cascades (e.g., Tier 1 -> Tier 2 -> Tier 3).
 */
export interface ExecutionSpec {
  mode: 'http' | 'extract' | 'browser';
  request?: RequestSpec;
  http?: HttpExecutionSpec;
  extract?: ExtractExecutionSpec;
  browser?: BrowserExecutionSpec;
  fallback?: ExecutionSpec;
}

export const ExecutionSpecSchema: z.ZodType<ExecutionSpec, z.ZodTypeDef, any> = z.lazy(() =>
  z.object({
    mode: z.enum(['http', 'extract', 'browser']),
    request: RequestSpecSchema.optional(),
    http: HttpExecutionSpecSchema.optional(),
    extract: ExtractExecutionSpecSchema.optional(),
    browser: BrowserExecutionSpecSchema.optional(),
    fallback: ExecutionSpecSchema.optional(),
  })
);

/**
 * Output schema definition for validation and OpenAPI / MCP generation.
 */
export const OutputPropertySchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'any']).default('any'),
  nullable: z.boolean().optional(),
  description: z.string().optional(),
});

export const OutputSchemaDefinition = z.object({
  type: z.enum(['object', 'array', 'any']).default('any'),
  description: z.string().optional(),
  required: z.array(z.string()).optional(),
  properties: z.record(z.string(), OutputPropertySchema).optional(),
  items: z
    .object({
      type: z.enum(['object', 'string', 'number', 'boolean', 'any']).default('object'),
      required: z.array(z.string()).optional(),
      properties: z.record(z.string(), OutputPropertySchema).optional(),
    })
    .optional(),
});

export type OutputSchemaDef = z.infer<typeof OutputSchemaDefinition>;

/**
 * Embedded test case inside a Blueprint for deterministic CI & offline fixture verification.
 */
export const BlueprintTestCaseSchema = z.object({
  name: z.string(),
  inputs: z.record(z.string(), z.any()).optional(),
  /** Optional mock response body (JSON or HTML string) for fast offline testing */
  mockResponse: z.any().optional(),
  expect: z.object({
    minItems: z.number().int().nonnegative().optional(),
    maxItems: z.number().int().positive().optional(),
    hasKeys: z.array(z.string()).optional(),
    equals: z.any().optional(),
    notEmpty: z.boolean().optional(),
  }),
});

export type BlueprintTestCase = z.infer<typeof BlueprintTestCaseSchema>;

/**
 * Complete OpenAct Blueprint Schema (.act.yaml).
 */
export const BlueprintSchema = z.object({
  id: z
    .string()
    .regex(
      /^[a-z0-9-]+\/[a-z0-9-]+$/,
      'Blueprint id must follow "namespace/name" format (lowercase alphanumeric and hyphens)'
    ),
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  description: z.string().min(1),
  category: z.string().default('general'),
  author: z.string().default('openact-community'),
  tags: z.array(z.string()).default([]),
  homepage: z.string().optional(),
  vaultProfile: z.string().optional(),
  rateLimit: z
    .object({
      requestsPerMinute: z.number().int().positive().default(60),
    })
    .optional(),
  cacheTtlSeconds: z.number().int().nonnegative().default(60),
  inputs: z.record(z.string(), InputParamSchema).default({}),
  execution: ExecutionSpecSchema,
  output: OutputSchemaDefinition.optional(),
  tests: z.array(BlueprintTestCaseSchema).default([]),
});

export type Blueprint = z.infer<typeof BlueprintSchema>;

/**
 * Validates raw data against the Blueprint Output Schema Definition.
 */
export function validateBlueprintOutput(
  data: unknown,
  schema?: OutputSchemaDef
): { valid: boolean; errors: string[] } {
  if (!schema || schema.type === 'any') {
    return { valid: true, errors: [] };
  }

  const errors: string[] = [];

  const checkObject = (
    obj: unknown,
    pathPrefix: string,
    required?: string[],
    properties?: Record<string, z.infer<typeof OutputPropertySchema>>
  ) => {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      errors.push(`${pathPrefix}: expected object, got ${Array.isArray(obj) ? 'array' : typeof obj}`);
      return;
    }
    const record = obj as Record<string, unknown>;
    if (required) {
      for (const reqKey of required) {
        if (record[reqKey] === undefined || record[reqKey] === null) {
          errors.push(`${pathPrefix}.${reqKey}: required field is missing or null`);
        }
      }
    }
    if (properties) {
      for (const [propKey, propSpec] of Object.entries(properties)) {
        const val = record[propKey];
        if (val === undefined) continue;
        if (val === null) {
          if (!propSpec.nullable) {
            errors.push(`${pathPrefix}.${propKey}: field is null but not marked nullable`);
          }
          continue;
        }
        if (propSpec.type !== 'any') {
          const actualType = Array.isArray(val) ? 'array' : typeof val;
          if (actualType !== propSpec.type) {
            errors.push(
              `${pathPrefix}.${propKey}: expected ${propSpec.type}, got ${actualType}`
            );
          }
        }
      }
    }
  };

  if (schema.type === 'array') {
    if (!Array.isArray(data)) {
      errors.push(`root: expected array, got ${typeof data}`);
      return { valid: false, errors };
    }
    if (schema.items && schema.items.type === 'object') {
      data.forEach((item, idx) => {
        checkObject(item, `root[${idx}]`, schema.items?.required, schema.items?.properties);
      });
    }
  } else if (schema.type === 'object') {
    checkObject(data, 'root', schema.required, schema.properties);
  }

  return { valid: errors.length === 0, errors };
}
