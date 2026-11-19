/**
 * Session teardown for a database switch.
 *
 * Switching the active database invalidates the current tenant: the target
 * database has its own company and its own users. Drop the session and any
 * tenant token so the boot layer evaluates the NEW database cleanly and lands
 * on the LOGIN page — never the onboarding wizard, which would re-seed a
 * database the user deliberately switched away from.
 *
 * Purely local (no navigation): the caller reloads right after. Kept as a
 * standalone module so the login-vs-onboarding contract is unit-testable.
 */
import { useAuthStore } from '@/modules/auth/store';
import { clearRelayToken } from '@/core/database/relayClient';

export function resetSessionForDatabaseSwitch(): void {
  try {
    useAuthStore.getState().logout();
  } catch {
    /* store unavailable — the reload re-evaluates anyway */
  }
  try {
    clearRelayToken();
  } catch {
    /* ignore */
  }
}
