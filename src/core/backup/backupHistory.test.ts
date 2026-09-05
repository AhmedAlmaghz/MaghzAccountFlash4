import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadHistory,
  newHistoryId,
  recordHistory,
  removeHistory,
  updateHistoryEntry,
  type BackupHistoryEntry,
} from './backupHistory';

const entry = (overrides: Partial<BackupHistoryEntry> = {}): BackupHistoryEntry => ({
  id: newHistoryId(),
  name: 'maghz-backup_test.mab',
  size: 1024,
  createdAt: new Date().toISOString(),
  kind: 'manual',
  encrypted: false,
  tables: 60,
  rows: 100,
  destinations: { local: true },
  ...overrides,
});

describe('backupHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty and records entries newest-first', () => {
    expect(loadHistory('co1')).toEqual([]);
    recordHistory('co1', entry({ createdAt: '2026-01-01T00:00:00Z' }));
    recordHistory('co1', entry({ createdAt: '2026-02-01T00:00:00Z' }));
    const list = loadHistory('co1');
    expect(list).toHaveLength(2);
    expect(list[0].createdAt).toBe('2026-02-01T00:00:00Z');
  });

  it('isolates companies from each other', () => {
    recordHistory('co1', entry());
    expect(loadHistory('co2')).toEqual([]);
  });

  it('updates destinations without touching the id', () => {
    const [saved] = [recordHistory('co1', entry())][0];
    const updated = updateHistoryEntry('co1', saved.id, { destinations: { driveFileId: 'abc' } });
    expect(updated[0].destinations).toEqual({ driveFileId: 'abc' });
    expect(updated[0].id).toBe(saved.id);
  });

  it('removes entries and caps the list at 30', () => {
    const first = recordHistory('co1', entry())[0];
    removeHistory('co1', first.id);
    expect(loadHistory('co1')).toEqual([]);
    for (let i = 0; i < 35; i++) recordHistory('co1', entry());
    expect(loadHistory('co1')).toHaveLength(30);
  });

  it('survives corrupted storage without throwing', () => {
    localStorage.setItem('maghz-backup-history', 'not-json{{{');
    expect(loadHistory('co1')).toEqual([]);
    expect(recordHistory('co1', entry())).toHaveLength(1);
  });
});
