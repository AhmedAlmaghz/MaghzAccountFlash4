import { describe, it, expect, beforeEach } from 'vitest';
import {
  listRemoteConnections,
  saveRemoteConnection,
  deleteRemoteConnection,
  getStoredActiveRemoteId,
  setStoredActiveRemoteId,
  getActiveRemoteUrl,
  findRemoteConnection,
  testRemoteConnection,
  describeConnection,
} from './connectionVault';

const NEON_URL = 'postgres://user:pass@ep-x.aws.neon.tech:5432/appdb';
const LOCAL_URL = 'postgres://maghz:secret@localhost:5432/appdb';

beforeEach(() => {
  localStorage.clear();
});

describe('web vault (device storage)', () => {
  it('saves and lists metadata without secrets', async () => {
    const saved = await saveRemoteConnection({ name: 'Prod', databaseUrl: NEON_URL });
    expect(saved.success).toBe(true);
    expect(saved.connection?.provider).toBe('neon');
    const list = await listRemoteConnections();
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('databaseUrl');
    expect(list[0].host).toBe('ep-x.aws.neon.tech');
  });
  it('rejects invalid URLs with a message', async () => {
    await expect(saveRemoteConnection({ name: 'x', databaseUrl: 'nope' })).rejects.toThrow();
    expect(await listRemoteConnections()).toHaveLength(0);
  });
  it('does not replace an existing entry with an unsupported local provider on web', async () => {
    const first = await saveRemoteConnection({ name: 'A', databaseUrl: NEON_URL });
    const id = first.connection!.id;
    const updated = await saveRemoteConnection({ id, name: 'B', databaseUrl: LOCAL_URL });
    expect(updated.success).toBe(false);
    expect(updated.error).toBe('webTcpUnsupported');
    const list = await listRemoteConnections();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('A');
    expect(list[0].provider).toBe('neon');
  });
  it('deletes and clears a dangling active pointer', async () => {
    const saved = await saveRemoteConnection({ name: 'A', databaseUrl: NEON_URL });
    setStoredActiveRemoteId(saved.connection!.id);
    await deleteRemoteConnection(saved.connection!.id);
    expect(await listRemoteConnections()).toHaveLength(0);
    expect(getStoredActiveRemoteId()).toBeNull();
  });
  it('round-trips the active id and secret URL', async () => {
    const saved = await saveRemoteConnection({ name: 'A', databaseUrl: NEON_URL });
    setStoredActiveRemoteId(saved.connection!.id);
    expect(getStoredActiveRemoteId()).toBe(saved.connection!.id);
    expect(await getActiveRemoteUrl()).toBe(NEON_URL);
    expect(await findRemoteConnection(saved.connection!.id)).not.toBeNull();
    expect(await findRemoteConnection('missing')).toBeNull();
  });
  it('returns null URL with no active connection', async () => {
    expect(await getActiveRemoteUrl()).toBeNull();
  });
});

describe('testRemoteConnection on web', () => {
  it('refuses non-Neon hosts with a stable code', async () => {
    const r = await testRemoteConnection(LOCAL_URL);
    expect(r.success).toBe(false);
    expect(r.error).toBe('webTcpUnsupported');
  });
  it('throws on garbage input', async () => {
    await expect(testRemoteConnection('garbage')).rejects.toThrow();
  });
});

describe('describeConnection', () => {
  it('formats without secrets', () => {
    const d = describeConnection({ provider: 'supabase', host: 'db.x.supabase.co', database: 'postgres', user: 'postgres' });
    expect(d).toContain('supabase');
    expect(d).toContain('db.x.supabase.co');
  });
});
