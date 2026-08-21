import { create } from 'zustand';
import type { User, Permission } from '@/modules/auth/types';
import { AuditLogger } from '@/core/audit';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

const AUTH_USER_KEY = 'auth_user';
const AUTH_ACTIVITY_KEY = 'auth_last_activity';
const AUTH_FINGERPRINT_KEY = 'auth_session_fingerprint';

/**
 * Read and parse the persisted auth payload from localStorage. Returns the
 * user object plus a `wrapped` flag that tells whether the payload is the
 * versioned envelope `{ version, issuedAt, fingerprint, user }` (which
 * carries a tab-bound fingerprint) or a plain serialized user.
 */
function readStoredAuth(): { user: User | null; wrapped: boolean; fingerprint?: string; permissions?: Permission[] } {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    if (!raw) return { user: null, wrapped: false };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object' && typeof parsed.version === 'number') {
      const user = (parsed.user ?? null) as User | null;
      const rawPerms = parsed.permissions;
      const permissions = Array.isArray(rawPerms) ? (rawPerms as Permission[]) : undefined;
      return { user, wrapped: true, fingerprint: typeof parsed.fingerprint === 'string' ? parsed.fingerprint : undefined, permissions };
    }
    if (parsed && typeof parsed === 'object' && typeof parsed.id === 'string') {
      return { user: parsed as unknown as User, wrapped: false };
    }
    return { user: null, wrapped: false };
  } catch {
    return { user: null, wrapped: false };
  }
}

function persistAuth(user: User, permissions: Permission[] = []): void {
  try {
    const fp = getSessionFingerprint() ?? generateFingerprint();
    setSessionFingerprint(fp);
    const envelope = { version: 2, issuedAt: Date.now(), fingerprint: fp, user, permissions };
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(envelope));
    localStorage.setItem(AUTH_ACTIVITY_KEY, String(Date.now()));
  } catch { /* storage unavailable */ }
}

function generateFingerprint(): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `fp-${rand}`;
}

function clearPersistedAuth(): void {
  try {
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(AUTH_ACTIVITY_KEY);
    sessionStorage.removeItem(AUTH_FINGERPRINT_KEY);
  } catch { /* storage unavailable */ }
}

function setSessionFingerprint(fp: string): void {
  try {
    sessionStorage.setItem(AUTH_FINGERPRINT_KEY, fp);
  } catch { /* storage unavailable */ }
}

function getSessionFingerprint(): string | null {
  try {
    return sessionStorage.getItem(AUTH_FINGERPRINT_KEY);
  } catch {
    return null;
  }
}

const FALLBACK_PERMISSIONS: Record<string, Permission[]> = {
  manager: [
    'core.view', 'accounting.view', 'accounting.create', 'accounting.edit', 'accounting.post',
    'inventory.view', 'inventory.create', 'inventory.edit',
    'sales.view', 'sales.create', 'sales.edit', 'sales.post',
    'purchases.view', 'purchases.create', 'purchases.edit',
    'manufacturing.view', 'manufacturing.create', 'manufacturing.edit', 'manufacturing.post',
    'reports.view', 'reports.export',
    'settings.view',
    'ai.use',
  ],
  accountant: [
    'core.view',
    'accounting.view', 'accounting.create', 'accounting.edit', 'accounting.post',
    'inventory.view',
    'sales.view', 'sales.create', 'sales.edit',
    'purchases.view', 'purchases.create', 'purchases.edit',
    'manufacturing.view',
    'reports.view', 'reports.export',
    'ai.use',
  ],
  sales_rep: [
    'sales.own', 'sales.create', 'sales.edit',
    'inventory.own',
    'crm.own', 'crm.create', 'crm.edit',
    'reports.view',
    'ai.use',
  ],
  viewer: [
    'core.view', 'accounting.view', 'inventory.view', 'sales.view',
    'purchases.view', 'manufacturing.view', 'reports.view',
  ],
};

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  permissions: Permission[];
  lastActivityAt: number | null;

  setUser: (user: User | null) => void;
  login: (user: User, permissions?: Permission[]) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  setPermissions: (permissions: Permission[]) => void;
  hasPermission: (permission: string) => boolean;
  hasRole: (roles: string[]) => boolean;
  checkSession: () => boolean;
  recordActivity: () => void;
  canAccessOwned: (modulePermission: string) => boolean;
  shouldFilterByOwner: (module: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  permissions: [],
  lastActivityAt: null,

  setUser: (user) => set({ user, isAuthenticated: !!user }),

  login: (user, permissions = []) => {
    set({ user, isAuthenticated: true, isLoading: false, permissions, lastActivityAt: Date.now() });
    persistAuth(user, permissions);
    void AuditLogger.logLogin();
  },

  logout: () => {
    const user = get().user;
    void window.electronAuth?.logout();
    set({ user: null, isAuthenticated: false, isLoading: false, permissions: [], lastActivityAt: null });
    clearPersistedAuth();
    if (user) {
      void AuditLogger.logLogout();
    }
  },

  setLoading: (loading) => set({ isLoading: loading }),

  setPermissions: (permissions) => set({ permissions }),

  hasPermission: (permission: string) => {
    const { user, permissions } = get();
    if (!user) return false;

    if (user.role === 'super_admin') return true;

    if (user.role === 'admin') {
      const restricted: string[] = ['core.edit'];
      return !restricted.includes(permission);
    }

    if (permissions.length > 0) {
      if (permissions.includes('*')) return true;
      return permissions.includes(permission as Permission);
    }

    const fallback = FALLBACK_PERMISSIONS[user.role] || [];
    return fallback.includes(permission as Permission);
  },

  hasRole: (roles: string[]) => {
    const { user } = get();
    if (!user) return false;
    return roles.includes(user.role);
  },

  checkSession: () => {
    const { lastActivityAt } = get();
    if (!lastActivityAt) return false;
    if (Date.now() - lastActivityAt > SESSION_TIMEOUT_MS) {
      get().logout();
      return false;
    }
    return true;
  },

  recordActivity: () => {
    const now = Date.now();
    set({ lastActivityAt: now });
    try {
      localStorage.setItem(AUTH_ACTIVITY_KEY, String(now));
    } catch { /* storage unavailable */ }
  },

  canAccessOwned: (modulePermission: string) => {
    return get().hasPermission(modulePermission);
  },

  shouldFilterByOwner: (module: string) => {
    const { user } = get();
    if (!user) return false;
    if (user.role === 'super_admin' || user.role === 'admin') return false;
    const fullPerm = `${module}.view` as Permission;
    const ownPerm = `${module}.own` as Permission;
    if (get().hasPermission(fullPerm)) return false;
    if (get().hasPermission(ownPerm)) return true;
    return false;
  },
}));

export async function initAuth(): Promise<void> {
  const storeApi = useAuthStore.getState();

  const stored = readStoredAuth();
  const persistedUser = stored.user;

  if (!persistedUser) {
    clearPersistedAuth();
    storeApi.setLoading(false);
    return;
  }

  // ── Session expiry ──────────────────────────────────────────────────
  // The timestamp is persisted by login()/recordActivity(). A fresh login
  // always has it; only a crashed/reset browser can present a payload
  // without one, which we treat as a fresh (non-expired) session.
  try {
    const rawActivity = localStorage.getItem(AUTH_ACTIVITY_KEY);
    if (rawActivity !== null) {
      const lastActivity = Number(rawActivity);
      if (!Number.isFinite(lastActivity) || Date.now() - lastActivity > SESSION_TIMEOUT_MS) {
        clearPersistedAuth();
        storeApi.setLoading(false);
        return;
      }
    }
  } catch { /* storage unavailable */ }

  // ── Session fingerprint (anti session-fixation) ─────────────────────
  // The renderer binds a session fingerprint in sessionStorage at login
  // time. A persisted payload that claims a wrapped version-1 envelope but
  // has no matching fingerprint (e.g. planted by another origin/tab) is
  // rejected and wiped.
  if (stored.wrapped) {
    const tabFingerprint = getSessionFingerprint();
    if (!tabFingerprint || tabFingerprint !== stored.fingerprint) {
      clearPersistedAuth();
      storeApi.setLoading(false);
      return;
    }
  }

  // ── Stale-user guard ────────────────────────────────────────────────
  // The user row may have been deleted (or the DB reset) since the session
  // was persisted. Verify the user still exists before restoring.
  try {
    const { getDbAdapter } = await import('@/core/database/adapters');
    const adapter = await getDbAdapter();
    const check = await adapter.query(
      'SELECT 1 FROM users WHERE id = $1::uuid AND is_active = true LIMIT 1',
      [persistedUser.id],
    );
    const exists = !!(check && check.success && check.rows && (check.rows as unknown[]).length > 0);
    if (!exists) {
      clearPersistedAuth();
      storeApi.setLoading(false);
      return;
    }
  } catch {
    // DB unavailable — do not lock the user out of a valid local session.
  }

  try {
    // Restore activity timestamp (persisted alongside the user envelope).
    let lastActivityAt: number | null = null;
    try {
      const rawActivity = localStorage.getItem(AUTH_ACTIVITY_KEY);
      if (rawActivity !== null) {
        const parsed = Number(rawActivity);
        if (Number.isFinite(parsed)) lastActivityAt = parsed;
      }
    } catch { /* storage unavailable */ }

    // Restore permissions. In Electron the trusted server session is the
    // source of truth — re-fetch it to pick up the freshest permissions
    // (including any role/permission changes made in another window). In
    // PGlite/web, fall back to the permissions snapshot persisted at login.
    let permissions: Permission[] = stored.permissions ?? [];
    try {
      const session = await window.electronAuth?.getSession();
      if (session && session.success && Array.isArray(session.permissions)) {
        permissions = session.permissions as Permission[];
      }
    } catch { /* non-Electron or unavailable — keep persisted snapshot */ }

    useAuthStore.setState({
      user: persistedUser,
      isAuthenticated: true,
      isLoading: false,
      permissions,
      lastActivityAt: lastActivityAt ?? Date.now(),
    });
  } catch {
    clearPersistedAuth();
  }

  storeApi.setLoading(false);
}
