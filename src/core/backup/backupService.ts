/**
 * Backup orchestration — reads/writes rows through the privileged path.
 *
 * - Electron: brand-new `db:backup-company` / `db:restore-company` IPC
 *   channels (session-scoped, settings-gated). The renderer never sends SQL.
 * - PGlite / web / e2e: direct adapter calls composed from the same plan.
 */

import { getDbAdapter, isElectronPg } from '@/core/database/adapters';
import {
  ALL_PLANNED_TABLES,
  BACKUP_MIME_TYPE,
  DELETE_ORDER,
  buildBackupFileName,
} from './backupTables';
import {
  composeRestoreBatch,
  decodeBackup,
  encodeBackup,
  selectForScope,
  type TablesMap,
} from './backupEngine';
import { deleteFromOpfs, listOpfs, opfsSupported, saveToOpfs } from './opfsStore';
import { loadHistory, newHistoryId, recordHistory } from './backupHistory';

interface ElectronBackupSurface {
  backupCompany?: () => Promise<{ success: boolean; tables?: TablesMap; warnings?: string[]; error?: string }>;
  restoreCompany?: (payload: { tables: TablesMap }) => Promise<{
    success: boolean;
    restored?: number;
    warnings?: string[];
    error?: string;
  }>;
}

function electronBackup(): ElectronBackupSurface | null {
  if (!isElectronPg()) return null;
  const db = (window as unknown as { electronDB?: ElectronBackupSurface }).electronDB;
  if (!db || (!db.backupCompany && !db.restoreCompany)) return null;
  return db;
}

export async function readBackupRows(companyId: string): Promise<{ tables: TablesMap; warnings: string[] }> {
  const via = electronBackup();
  if (via?.backupCompany) {
    const res = await via.backupCompany();
    if (!res.success) throw new Error(res.error || 'Backup read failed');
    return { tables: res.tables ?? {}, warnings: res.warnings ?? [] };
  }
  const adapter = await getDbAdapter();
  const tables: TablesMap = {};
  const warnings: string[] = [];
  for (const plan of DELETE_ORDER) {
    try {
      const { sql } = selectForScope(plan);
      const res = await adapter.query(sql, [companyId]);
      if (res.success && res.rows) {
        tables[plan.table] = res.rows as Record<string, unknown>[];
      } else {
        warnings.push(`${plan.table}: ${res.error || 'skipped'}`);
      }
    } catch (err) {
      // Missing table (retired) or guard denial — skip, never abort all.
      warnings.push(`${plan.table}: ${err instanceof Error ? err.message : 'skipped'}`);
    }
  }
  return { tables, warnings };
}

export async function applyRestore(
  companyId: string,
  tables: TablesMap,
): Promise<{ restored: number; warnings: string[] }> {
  const via = electronBackup();
  if (via?.restoreCompany) {
    const res = await via.restoreCompany({ tables });
    if (!res.success) throw new Error(res.error || 'Restore failed');
    return { restored: res.restored ?? 0, warnings: res.warnings ?? [] };
  }
  const { statements, warnings } = composeRestoreBatch(companyId, tables);
  if (statements.length === 0) return { restored: 0, warnings };
  const adapter = await getDbAdapter();
  const res = await adapter.transaction(statements.map((s) => ({ sql: s.sql, params: s.params })));
  if (!res.success) throw new Error(res.error || 'Restore transaction failed');
  const restored = Object.values(tables).reduce((n, rows) => n + (Array.isArray(rows) ? rows.length : 0), 0);
  return { restored, warnings };
}

// ---------------------------------------------------------------------------
// backup-scoped settings (category 'backup'), same upsert pattern as invoice.*
// ---------------------------------------------------------------------------

export async function getBackupSetting(companyId: string, key: string): Promise<string | null> {
  try {
    const adapter = await getDbAdapter();
    const res = await adapter.query<{ value: string }>(
      'SELECT value FROM settings WHERE company_id = $1 AND key = $2 LIMIT 1',
      [companyId, key],
    );
    if (res.success && res.rows?.[0]) return String(res.rows[0].value);
  } catch {
    // ignore — callers fall back to defaults
  }
  return null;
}

export async function setBackupSetting(companyId: string, key: string, value: string): Promise<void> {
  const adapter = await getDbAdapter();
  const res = await adapter.query(
    `INSERT INTO settings (id, company_id, key, value, category) VALUES ($1, $2, $3, $4, 'backup')
     ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [crypto.randomUUID(), companyId, key, value],
  );
  if (!res.success) throw new Error(res.error || 'Could not save setting');
}

// ---------------------------------------------------------------------------
// local-device file pickers (File System Access API with anchor fallback)
// ---------------------------------------------------------------------------

interface SavePicker {
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }>;
  showOpenFilePicker?: (opts: {
    types?: { description?: string; accept: Record<string, string[]> }[];
    multiple?: boolean;
  }) => Promise<{ getFile: () => Promise<File> }[]>;
}

function pickerHost(): SavePicker {
  return window as unknown as SavePicker;
}

export function filePickersSupported(): boolean {
  const host = pickerHost();
  return typeof host.showSaveFilePicker === 'function' && typeof host.showOpenFilePicker === 'function';
}

export async function downloadEnvelopeText(fileName: string, text: string): Promise<{ savedToDevice: boolean }> {
  const host = pickerHost();
  if (typeof host.showSaveFilePicker === 'function') {
    try {
      const handle = await host.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'MaghzAccount backup', accept: { [BACKUP_MIME_TYPE]: ['.mab'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return { savedToDevice: true };
    } catch (err) {
      // AbortError = user cancelled — not a failure, just report unsaved.
      if (err instanceof Error && err.name === 'AbortError') return { savedToDevice: false };
      // Fall through to the anchor download on real errors.
    }
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
  return { savedToDevice: true };
}

export async function pickBackupText(): Promise<{ name: string; text: string } | null> {
  const host = pickerHost();
  if (typeof host.showOpenFilePicker === 'function') {
    try {
      const [handle] = await host.showOpenFilePicker({
        types: [{ description: 'MaghzAccount backup', accept: { [BACKUP_MIME_TYPE]: ['.mab'], 'application/json': ['.json'] } }],
        multiple: false,
      });
      if (!handle) return null;
      const file = await handle.getFile();
      return { name: file.name, text: await file.text() };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return null;
      throw err;
    }
  }
  // Fallback: classic file input (also the path unit tests use).
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mab,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        resolve({ name: file.name, text: await file.text() });
      } catch (e) {
        reject(e);
      }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export { ALL_PLANNED_TABLES };

const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_AUTO_OPFS = 7;

/**
 * Silent daily auto-backup (OPFS only — browsers cannot pop a download
 * dialog unattended). Runs at most once per 24h per company. All failures
 * are swallowed: an auto-backup must never interrupt the user.
 */
export async function maybeAutoBackup(companyId: string, companyName: string): Promise<boolean> {
  try {
    const enabled = await getBackupSetting(companyId, 'backup.autoEnabled');
    if (enabled !== 'true') return false;
    const last = await getBackupSetting(companyId, 'backup.lastAutoAt');
    if (last && Date.now() - Number(last) < AUTO_INTERVAL_MS) return false;
    if (!opfsSupported()) return false;

    const { tables } = await readBackupRows(companyId);
    const envelope = await encodeBackup(tables, { companyId, companyName });
    const { manifest } = await decodeBackup(envelope);
    const name = buildBackupFileName(companyName);
    const { size } = await saveToOpfs(name, envelope);
    recordHistory(companyId, {
      id: newHistoryId(),
      name,
      size,
      createdAt: new Date().toISOString(),
      kind: 'auto',
      encrypted: false,
      tables: Object.keys(manifest.tables).length,
      rows: manifest.totalRows,
      destinations: { opfs: true },
    });
    await setBackupSetting(companyId, 'backup.lastAutoAt', String(Date.now()));
    // Prune OPFS to the newest auto backups.
    const autoNames = new Set(
      loadHistory(companyId)
        .filter((h) => h.kind === 'auto')
        .map((h) => h.name),
    );
    const stale = (await listOpfs()).filter((f) => autoNames.has(f.name)).slice(MAX_AUTO_OPFS);
    for (const f of stale) {
      try {
        await deleteFromOpfs(f.name);
      } catch {
        // best-effort
      }
    }
    return true;
  } catch {
    return false;
  }
}
