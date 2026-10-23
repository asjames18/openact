import { Blueprint } from '../schema/blueprint.js';

export interface TemplateContext {
  inputs: Record<string, unknown>;
  vault?: Record<string, string>;
  env?: Record<string, string | undefined>;
}

/**
 * Resolves and validates inputs against a Blueprint's input parameter schema,
 * applying defaults and type coercion.
 */
export function resolveBlueprintInputs(
  blueprint: Blueprint,
  rawInputs: Record<string, unknown> = {}
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...rawInputs };

  for (const [key, spec] of Object.entries(blueprint.inputs)) {
    let val = resolved[key];

    if (val === undefined || val === null || val === '') {
      if (spec.default !== undefined) {
        val = spec.default;
      } else if (spec.required) {
        throw new Error(`Missing required input parameter: "${key}"`);
      } else {
        val = '';
      }
    }

    // Coerce primitive types if passed from CLI or query string
    if (val !== '' && val !== undefined && val !== null) {
      if (spec.type === 'number' && typeof val === 'string') {
        const parsed = Number(val);
        if (Number.isNaN(parsed)) {
          throw new Error(`Input "${key}" must be a valid number (got "${val}")`);
        }
        val = parsed;
      } else if (spec.type === 'boolean' && typeof val === 'string') {
        val = val === 'true' || val === '1' || val === 'yes';
      }
    }

    if (spec.enum && spec.enum.length > 0 && val !== '') {
      if (!spec.enum.includes(String(val))) {
        throw new Error(
          `Input "${key}" must be one of [${spec.enum.join(', ')}] (got "${String(val)}")`
        );
      }
    }

    resolved[key] = val;
  }

  return resolved;
}

/**
 * Interpolates `{{inputs.foo}}`, `{{urlencode inputs.foo}}`, `{{vault.bar}}`, and `{{env.BAZ}}`
 * placeholders in strings, objects, and arrays.
 */
export function interpolateTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr: string) => {
    const trimmed = expr.trim();
    const parts = trimmed.split(/\s+/);
    let helper: string | null = null;
    let targetPath = trimmed;

    if (parts.length === 2) {
      helper = parts[0];
      targetPath = parts[1];
    }

    const [scope, ...rest] = targetPath.split('.');
    const key = rest.join('.');
    let rawValue: unknown = '';

    if (scope === 'inputs') {
      rawValue = ctx.inputs[key];
    } else if (scope === 'vault') {
      rawValue = ctx.vault?.[key] ?? '';
    } else if (scope === 'env') {
      rawValue = (ctx.env ?? process.env)?.[key] ?? '';
    } else {
      // Fallback direct lookup in inputs
      rawValue = ctx.inputs[targetPath];
    }

    const strVal = rawValue === undefined || rawValue === null ? '' : String(rawValue);

    if (helper === 'urlencode') {
      return encodeURIComponent(strVal);
    }
    if (helper === 'lowercase') {
      return strVal.toLowerCase();
    }
    if (helper === 'uppercase') {
      return strVal.toUpperCase();
    }
    return strVal;
  });
}

/**
 * Deeply interpolates templates across strings, arrays, or plain objects.
 */
export function interpolateDeep<T>(value: T, ctx: TemplateContext): T {
  if (typeof value === 'string') {
    return interpolateTemplate(value, ctx) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateDeep(item, ctx)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = interpolateDeep(v, ctx);
    }
    return result as T;
  }
  return value;
}
