import { FieldMapping, TransformStep } from '../schema/blueprint.js';

/**
 * Evaluates a dot/bracket path against a nested JavaScript object or array.
 * Supports:
 * - "$" or "" (returns root)
 * - "data.children"
 * - "items[0].title"
 * - "data.children[].data.title" (maps over arrays automatically)
 */
export function getByPath(obj: unknown, pathExpr?: string): unknown {
  if (!pathExpr || pathExpr === '$' || pathExpr === '.') {
    return obj;
  }

  // Normalize bracket array access: `items[0].name` -> `items.0.name`, `children[].data` -> `children.[].data`
  const normalized = pathExpr
    .replace(/^\$\.?/, '')
    .replace(/\[\]/g, '.[]')
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/^\./, '');

  const segments = normalized.split('.').filter(Boolean);

  function traverse(current: unknown, idx: number): unknown {
    if (current === undefined || current === null) return undefined;
    if (idx >= segments.length) return current;

    const segment = segments[idx];

    if (segment === '[]') {
      if (!Array.isArray(current)) return [];
      return current
        .map((item) => traverse(item, idx + 1))
        .filter((v) => v !== undefined);
    }

    if (Array.isArray(current)) {
      const numIdx = Number(segment);
      if (!Number.isInteger(numIdx)) {
        // Automatically map property lookup across array elements
        return current
          .map((item) => traverse(item, idx))
          .filter((v) => v !== undefined);
      }
      return traverse(current[numIdx], idx + 1);
    }

    if (typeof current === 'object') {
      const next = (current as Record<string, unknown>)[segment];
      return traverse(next, idx + 1);
    }

    return undefined;
  }

  return traverse(obj, 0);
}

/**
 * Applies a single declarative TransformStep to a value.
 */
export function applyTransformStep(value: unknown, step: TransformStep): unknown {
  if (typeof step === 'string') {
    const str = value === undefined || value === null ? '' : String(value);

    switch (step) {
      case 'trim':
        return typeof value === 'string' ? value.trim() : str.trim();
      case 'lowercase':
        return str.toLowerCase();
      case 'uppercase':
        return str.toUpperCase();
      case 'collapseWhitespace':
        return str.replace(/\s+/g, ' ').trim();
      case 'firstLine':
        return str.split(/\r?\n/)[0]?.trim() ?? '';
      case 'stripLeadingSlash':
        return str.replace(/^\/+/, '');
      case 'stripTrailingSlash':
        return str.replace(/\/+$/, '');
      case 'stripHtml':
        return str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      case 'decodeUri':
        try {
          return decodeURIComponent(str);
        } catch {
          return str;
        }
      case 'encodeUri':
        return encodeURIComponent(str);
      case 'extractNumber': {
        if (typeof value === 'number') return Math.trunc(value);
        // Handle shorthand suffixes like "12.4k" or "1,234"
        const match = str.replace(/,/g, '').match(/-?\d+(\.\d+)?([kKmMbB])?/);
        if (!match) return null;
        let num = parseFloat(match[0]);
        const suffix = match[2]?.toLowerCase();
        if (suffix === 'k') num *= 1_000;
        if (suffix === 'm') num *= 1_000_000;
        if (suffix === 'b') num *= 1_000_000_000;
        return Math.round(num);
      }
      case 'extractFloat': {
        if (typeof value === 'number') return value;
        const match = str.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
        return match ? parseFloat(match[0]) : null;
      }
      case 'boolean': {
        if (typeof value === 'boolean') return value;
        const lower = str.trim().toLowerCase();
        return lower === 'true' || lower === '1' || lower === 'yes';
      }
      case 'parseJson': {
        if (typeof value !== 'string') return value;
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      default:
        return value;
    }
  }

  // Parameterized object transforms
  if (typeof step === 'object' && step !== null) {
    const str = value === undefined || value === null ? '' : String(value);

    if ('prefix' in step && typeof step.prefix === 'string') {
      if (!str) return str;
      return str.startsWith(step.prefix) ? str : `${step.prefix}${str}`;
    }

    if ('suffix' in step && typeof step.suffix === 'string') {
      if (!str) return str;
      return str.endsWith(step.suffix) ? str : `${str}${step.suffix}`;
    }

    if ('replace' in step && typeof step.replace === 'object' && step.replace !== null) {
      const { from, to = '' } = step.replace as { from: string; to?: string };
      return str.replace(new RegExp(from, 'g'), to);
    }

    if ('regexExtract' in step && typeof step.regexExtract === 'string') {
      const regex = new RegExp(step.regexExtract);
      const match = str.match(regex);
      if (!match) return null;
      return match[1] !== undefined ? match[1] : match[0];
    }

    if ('split' in step && typeof step.split === 'string') {
      if (!str) return [];
      return str.split(step.split).map((s) => s.trim()).filter(Boolean);
    }

    if ('join' in step && typeof step.join === 'string') {
      if (Array.isArray(value)) {
        return value.join(step.join);
      }
      return str;
    }

    if ('slice' in step && Array.isArray(step.slice)) {
      const [start, end] = step.slice as [number, number?];
      if (Array.isArray(value) || typeof value === 'string') {
        return value.slice(start, end);
      }
    }

    if ('default' in step) {
      if (value === undefined || value === null || value === '') {
        return step.default;
      }
      return value;
    }

    if ('multiply' in step && typeof step.multiply === 'number') {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isNaN(n) ? null : n * step.multiply;
    }
  }

  return value;
}

/**
 * Runs an array of TransformSteps sequentially on an extracted value.
 */
export function applyTransforms(
  value: unknown,
  transforms?: TransformStep[],
  defaultValue?: unknown
): unknown {
  let current = value;

  if (Array.isArray(transforms)) {
    for (const step of transforms) {
      if (Array.isArray(current) && typeof step === 'string' && step !== 'parseJson') {
        current = current.map((item) => applyTransformStep(item, step));
      } else {
        current = applyTransformStep(current, step);
      }
    }
  }

  if (
    (current === undefined || current === null || current === '') &&
    defaultValue !== undefined
  ) {
    return defaultValue;
  }

  return current === undefined ? null : current;
}

/**
 * Extracts a mapped object from a source JSON record using FieldMapping specifications.
 */
export function extractFieldsFromJson(
  sourceItem: unknown,
  fields?: Record<string, FieldMapping>
): unknown {
  if (!fields || Object.keys(fields).length === 0) {
    return sourceItem;
  }

  const output: Record<string, unknown> = {};
  for (const [fieldName, mapping] of Object.entries(fields)) {
    if (typeof mapping === 'string') {
      const val = getByPath(sourceItem, mapping);
      output[fieldName] = val === undefined ? null : val;
    } else {
      if (mapping.constant !== undefined) {
        output[fieldName] = mapping.constant;
        continue;
      }
      const pathExpr = mapping.path ?? mapping.selector ?? fieldName;
      const rawVal = getByPath(sourceItem, pathExpr);
      output[fieldName] = applyTransforms(rawVal, mapping.transform, mapping.default);
    }
  }

  return output;
}
