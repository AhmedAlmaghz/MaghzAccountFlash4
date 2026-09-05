/**
 * Local backup history — per-company metadata in localStorage.
 * Only metadata is kept (never file contents): local files live wherever
 * the user saved them, auto backups live in OPFS, cloud copies on Drive.
 */

export type BackupKind = 'manual' | 'auto';

export interface BackupDestinations {
  /** saved to the user's device (download) */
  local?: boolean;
  /** kept in Origin Private File System (auto backups) */
  opfs?: boolean;
  /** Google Drive file id when uploaded */
  driveFileId?: string;
}

export interface BackupHistoryEntry {
  id: string;
  name: string;
  size: number;
  createdAt: string;
  kind: BackupKind;
  encrypted: boolean;
  tables: number;
  rows: number;
  destinations: BackupDestinations;
}

const HISTORY_KEY = 'maghz-backup-history';
const MAX_ENTRIES = 30;

function readAll(): Record<string, BackupHistoryEntry[]> {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as Record<string, BackupHistoryEntry[]>;
  } catch {
    // corrupted history — start fresh rather than crash the page
  }
  return {};
}

function writeAll(all: Record<string, BackupHistoryEntry[]>): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
  } catch {
    // storage full/blocked — history is best-effort
  }
}

export function newHistoryId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export function loadHistory(companyId: string): BackupHistoryEntry[] {
  const entries = readAll()[companyId];
  if (!Array.isArray(entries)) return [];
  return [...entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function recordHistory(companyId: string, entry: BackupHistoryEntry): BackupHistoryEntry[] {
  const all = readAll();
  const list = [...(Array.isArray(all[companyId]) ? all[companyId] : []), entry]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, MAX_ENTRIES);
  all[companyId] = list;
  writeAll(all);
  return list;
}

export function updateHistoryEntry(
  companyId: string,
  id: string,
  patch: Partial<BackupHistoryEntry>,
): BackupHistoryEntry[] {
  const all = readAll();
  const list = Array.isArray(all[companyId]) ? all[companyId] : [];
  all[companyId] = list.map((e) => (e.id === id ? { ...e, ...patch, id } : e));
  writeAll(all);
  return all[companyId];
}

export function removeHistory(companyId: string, id: string): BackupHistoryEntry[] {
  const all = readAll();
  const list = Array.isArray(all[companyId]) ? all[companyId] : [];
  all[companyId] = list.filter((e) => e.id !== id);
  writeAll(all);
  return all[companyId];
}
