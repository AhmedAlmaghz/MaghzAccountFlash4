/**
 * Normalize a date-like value (Date, ISO string, or YYYY-MM-DD string) into
 * a YYYY-MM-DD string suitable for PG `date`/`timestamp` columns.
 *
 * The pg driver may return `timestamp` columns as JavaScript `Date` objects
 * whose `toString()` yields locale-dependent formats like
 * `"Mon Jul 13 2026 00:00:00 GMT+0300 (...)"`. Sending that string back to PG
 * causes: `invalid input syntax for type timestamp with time zone`.
 *
 * We deliberately use local-time date components (`getFullYear`/`getMonth`/
 * `getDate`) rather than `toISOString()` to avoid timezone shifts: a Date
 * constructed for midnight in GMT+0300 is the previous calendar day in UTC,
 * so `.toISOString().slice(0, 10)` would silently move it back one day. The
 * PG `date` column has no time component, so the local calendar day is the
 * correct interpretation.
 */
export function toDateString(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return value as null | undefined;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'string') {
    if (value === '') return null;
    // Already in YYYY-MM-DD format (most common case)
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    // Attempt to parse and reformat using local-time components
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, '0');
      const d = String(parsed.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return value;
  }
  return String(value);
}

/**
 * Utility to map PostgreSQL snake_case row keys to camelCase.
 * Also auto-converts numeric strings to numbers and Date objects to ISO date strings.
 */
export function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  if (!obj || typeof obj !== 'object') return obj;
  // Don't recurse into Date, Buffer, or other non-plain objects
  if (obj instanceof Date) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      typeof item === 'object' && item !== null && !(item instanceof Date)
        ? snakeToCamel(item as Record<string, unknown>)
        : item
    ) as unknown as Record<string, unknown>;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    // Convert snake_case to camelCase
    const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    if (val === null || val === undefined) {
      out[camelKey] = val;
    } else if (val instanceof Date) {
      // Convert Date objects to YYYY-MM-DD strings using local-time components
      // to avoid timezone shifts (toISOString would move midnight GMT+0300
      // back one day in UTC).
      if (isNaN(val.getTime())) {
        out[camelKey] = null;
      } else {
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        out[camelKey] = `${y}-${m}-${d}`;
      }
    } else if (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val)) {
      // Auto-convert string numbers (from PG numeric/decimal)
      const n = Number(val);
      out[camelKey] = isNaN(n) ? val : n;
    } else if (typeof val === 'object') {
      out[camelKey] = snakeToCamel(val as Record<string, unknown>);
    } else {
      out[camelKey] = val;
    }
  }
  return out;
}

export function mapRows<T = unknown>(rows: Record<string, unknown>[] | undefined): T[] {
  return (rows || []).map((r) => snakeToCamel(r) as T);
}
