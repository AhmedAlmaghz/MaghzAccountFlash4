import type { DbMode } from './adapters';

/**
 * Single database-setup flow shared by the onboarding wizard and the
 * settings page. Before this service both screens reimplemented the same
 * four steps with slightly different error mapping (validate → test →
 * save+activate → mode), so a fix in one never reached the other.
 *
 * Error contract: every failure returns a STABLE code (`webTcpUnsupported`,
 * `relayBlockedTarget`, `setup-locked`, …) plus the raw message. UI layers
 * map codes to i18n guidance and NEVER regex-match prose.
 */

export interface SetupTestOutcome {
  ok: boolean;
  db?: string;
  version?: string;
  error?: string;
  code?: string;
}

export interface SetupSaveOutcome {
  ok: boolean;
  connectionId?: string;
  error?: string;
  code?: string;
}

/** Validate a pasted URL: provider badge + host line for the form, or an error. */
export async function parseDatabaseUrlInput(raw: string): Promise<
  | { ok: true; url: string; provider: string; host: string; database: string }
  | { ok: false; error: string }
> {
  const { parseDatabaseUrl } = await import('./connection');
  try {
    const parsed = parseDatabaseUrl(raw);
    return { ok: true, url: parsed.raw, provider: parsed.provider, host: parsed.host, database: parsed.database };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid URL' };
  }
}

/** Probe a URL without saving anything (desktop TCP / Neon HTTP / relay). */
export async function testDatabaseUrl(url: string): Promise<SetupTestOutcome> {
  const { testRemoteConnection } = await import('./connectionVault');
  try {
    const r = await testRemoteConnection(url);
    if (r.success) return { ok: true, db: r.db, version: r.version };
    return { ok: false, error: r.error, code: (r as { code?: string }).code };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Persist a URL to the vault (desktop keychain / device storage). */
export async function saveDatabaseUrl(name: string, url: string): Promise<SetupSaveOutcome> {
  const { saveRemoteConnection } = await import('./connectionVault');
  try {
    const saved = await saveRemoteConnection({ name, databaseUrl: url });
    if (!saved.success || !saved.connection) {
      return { ok: false, error: saved.error, code: (saved as { code?: string }).code };
    }
    return { ok: true, connectionId: saved.connection.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Validate → save → activate in one honest flow (single error surface). */
export async function saveAndActivateDatabase(name: string, url: string): Promise<SetupSaveOutcome> {
  const { setStoredActiveRemoteId } = await import('./connectionVault');
  const saved = await saveDatabaseUrl(name, url);
  if (!saved.ok || !saved.connectionId) return saved;
  setStoredActiveRemoteId(saved.connectionId);
  // Mirror to the desktop vault when a bridge exists (best-effort; the
  // reload after activation re-reads everything anyway).
  try {
    const surface = (
      window as unknown as {
        electronDB?: { connections?: { setActive?: (p: { id: string | null }) => Promise<unknown> } };
      }
    ).electronDB?.connections;
    if (surface?.setActive) await surface.setActive({ id: saved.connectionId });
  } catch {
    /* best-effort */
  }
  return saved;
}

/** Persist the backend choice and let the next getDbAdapter() re-resolve. */
export async function applyDbMode(mode: DbMode): Promise<void> {
  const { setDbMode } = await import('./adapters');
  setDbMode(mode);
}

/**
 * Seed-step safety net (direct navigation to a later step): if the active
 * vault is empty but the wizard holds a URL, persist + activate it so the
 * adapter layer can find it. No-op otherwise. Returns nothing — failures
 * are best-effort here; the seed call itself reports the real error.
 */
export async function ensureVaultPopulated(name: string, url: string): Promise<void> {
  try {
    // Desktop owns activation in the main-process vault — the renderer
    // pointer is meaningless there, so there is nothing to backfill.
    if (typeof window !== 'undefined' && (window as { electronDB?: unknown }).electronDB) return;
    const { getActiveRemoteUrl } = await import('./connectionVault');
    if (await getActiveRemoteUrl()) return;
    const saved = await saveAndActivateDatabase(name, url);
    if (!saved.ok) {
      console.warn('[databaseSetup] vault backfill failed:', saved.error);
    }
  } catch {
    /* best-effort */
  }
}

/**
 * Map a backend code to a translated sentence. Centralizes the mapping both
 * UIs duplicated (and diverged on): codes win over prose, prose falls back
 * to the raw message, and the caller supplies the last-resort key.
 */
export function describeSetupError(
  t: (key: string) => string,
  outcome: { error?: string; code?: string } | null | undefined,
  fallbackKey: string,
): string {
  const code = outcome?.code;
  const error = outcome?.error;
  if (code === 'setup-locked') return t('settings.database.setupLocked');
  if (error === 'webTcpUnsupported') return t('settings.database.webTcpDesc');
  if (error === 'relayBlockedTarget') return t('settings.database.relayBlockedTarget');
  return error || t(fallbackKey);
}
