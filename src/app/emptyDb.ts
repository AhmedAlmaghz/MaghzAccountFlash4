/**
 * Empty-database recovery predicate (web + desktop unification).
 *
 * All three adapters (PGlite, Neon HTTP, Electron RPC) report a reachable
 * but company-less database with the identical envelope
 * `{ success: false, error: 'No company found' }`. Booting into the router
 * on that signal leaves every page company-less (infinite spinners, dead
 * saves) — the boot layer must re-open the onboarding wizard instead, which
 * provisions company + admin on the ACTIVE adapter.
 *
 * Pure function (no store/IO) so it stays unit-testable under any runtime.
 */
export interface CompanyProbeResult {
  success: boolean;
  error?: string;
}

export function isEmptyDatabaseResult(result: CompanyProbeResult | null | undefined): boolean {
  return (
    !!result &&
    result.success === false &&
    /no company found/i.test(result.error || '')
  );
}
