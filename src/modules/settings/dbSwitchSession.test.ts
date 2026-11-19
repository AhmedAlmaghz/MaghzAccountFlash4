/**
 * Regression gate — database switch must land on the LOGIN page, not the
 * onboarding wizard.
 *
 * Historic bug: switching the active database kept the old session alive, so
 * the post-reload boot carried a stale tenant identity into the NEW database.
 * The session-scoped company read then failed in ways the boot layer could
 * misread as an empty database, and main.tsx opened the onboarding wizard —
 * re-seeding a database the user had deliberately switched away from.
 *
 * Contract pinned here: `resetSessionForDatabaseSwitch()` clears BOTH the
 * auth session (logout + persisted envelope) and the relay tenant token, so
 * the reload starts unauthenticated and ProtectedRoute routes to /login.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const clearRelayToken = vi.fn();
vi.mock('@/core/database/relayClient', () => ({ clearRelayToken: () => clearRelayToken() }));

// Import after the mock registration (hoisted by vitest).
import { resetSessionForDatabaseSwitch } from './dbSwitchSession';
import { useAuthStore } from '@/modules/auth/store';

const makeUser = (id: string) => ({
  id,
  companyId: 'co-1',
  username: 'admin',
  role: 'admin',
  isActive: true,
} as unknown as Parameters<ReturnType<typeof useAuthStore.getState>['login']>[0]);

describe('resetSessionForDatabaseSwitch', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    clearRelayToken.mockClear();
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, permissions: [] });
  });

  it('logs the user out and clears the relay tenant token', () => {
    useAuthStore.getState().login(makeUser('u1'), ['settings.view']);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    resetSessionForDatabaseSwitch();

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().permissions).toEqual([]);
    expect(clearRelayToken).toHaveBeenCalledTimes(1);
  });

  it('removes the persisted auth envelope so the reload boots unauthenticated', () => {
    useAuthStore.getState().login(makeUser('u2'), []);
    expect(window.localStorage.getItem('auth_user')).not.toBeNull();

    resetSessionForDatabaseSwitch();

    expect(window.localStorage.getItem('auth_user')).toBeNull();
    // lastActivityAt is part of the session envelope — must go too, or the
    // restored session could be resurrected after the reload.
    expect(window.localStorage.getItem('auth_last_activity')).toBeNull();
  });

  it('survives a relay-token failure (logout already applied, reload still proceeds)', () => {
    useAuthStore.getState().login(makeUser('u3'), []);
    clearRelayToken.mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    expect(() => resetSessionForDatabaseSwitch()).not.toThrow();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
