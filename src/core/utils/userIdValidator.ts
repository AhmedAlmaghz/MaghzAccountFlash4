/**
 * Validate and resolve a userId for FK columns (created_by / updated_by / assigned_to).
 *
 * The DB enforces FK constraints via `ON DELETE SET NULL`, but the constraint still
 * rejects `INSERT/UPDATE` if the UUID doesn't exist in the `users` table. This
 * commonly happens when:
 *   - The user was deleted but the JWT/auth store still references their id
 *   - The user object was hydrated from a stale localStorage session whose DB
 *     has since been reset or migrated to a different seed
 *   - A mock test or migration left the auth store with a fabricated id
 *
 * Without this validation, every `UPDATE/INSERT` would fail with:
 *   `insert or update on table "X" violates foreign key constraint "X_user_fkey"`
 *
 * The helper:
 *   1. Returns `null` for falsy / non-string / non-UUID-format input
 *   2. Returns `null` for empty string / whitespace
 *   3. Otherwise passes the value through after a format check
 *
 * To verify existence against DB (catches stale UUIDs from prior sessions),
 * use `resolveExistingUserId(adapter, userId, companyId)` which performs a
 * cached `SELECT 1 FROM users WHERE id = $1` lookup.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

/**
 * Format-validate a userId without hitting the DB. Use this when you trust the
 * caller (e.g., a fresh login that just fetched the user row).
 */
export function safeUserId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return isUuid(trimmed) ? trimmed.toLowerCase() : null;
}

// Module-level cache so repeated mutations in the same request don't re-query
const userIdCache = new Map<string, boolean>();

/**
 * Verify a userId is a valid UUID AND exists in the users table. Returns the
 * id if valid, `null` otherwise. Caches results for the lifetime of the page.
 *
 * Use this for audit columns where the user may come from a stale source
 * (localStorage hydration, prior session, manual test).
 */
export async function resolveExistingUserId(
  adapter: { query: (sql: string, params: unknown[]) => Promise<{ success: boolean; rows?: Record<string, unknown>[] }> },
  userId: unknown,
  _companyId?: string
): Promise<string | null> {
  const valid = safeUserId(userId);
  if (!valid) return null;

  const cached = userIdCache.get(valid);
  if (cached !== undefined) return cached ? valid : null;

  try {
    const result = await adapter.query(
      'SELECT 1 FROM users WHERE id = $1::uuid AND is_active = true LIMIT 1',
      [valid]
    );
    const exists = !!(result.success && result.rows && result.rows.length > 0);
    userIdCache.set(valid, exists);
    return exists ? valid : null;
  } catch {
    userIdCache.set(valid, false);
    return null;
  }
}

/** Test-only: clear the cache between unit tests. */
export function clearUserIdCache(): void {
  userIdCache.clear();
}
