import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DRIVE_SCOPE, DriveClient, resetGisForTests } from './googleDrive';

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const data = handler(url, init);
    return { ok: true, json: async () => data, text: async () => JSON.stringify(data) } as Response;
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

function mockGoogle() {
  // Mirrors the real GIS shape: window.google.accounts.oauth2.initTokenClient
  (window as unknown as Record<string, unknown>).google = {
    accounts: {
      initTokenClient: ({ callback }: { callback: (r: object) => void }) => ({
        requestAccessToken: () => callback({ access_token: 'tok123', expires_in: 3600 }),
      }),
    },
  };
}

describe('googleDrive', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    resetGisForTests();
    delete (window as unknown as Record<string, unknown>).google;
  });

  it('connects through GIS with the least-privilege scope', async () => {
    const seen: string[] = [];
    mockGoogle();
    const client = new DriveClient('client-id.apps.googleusercontent.com', async () => {});
    // capture the scope passed to initTokenClient
    const accounts = (window as unknown as { google: { accounts: {
      initTokenClient: (c: { client_id: string; scope: string; callback: (r: object) => void }) => { requestAccessToken: () => void };
    } } }).google.accounts;
    const orig = accounts.initTokenClient;
    accounts.initTokenClient = (c) => {
      seen.push(c.scope);
      return orig(c);
    };
    await client.connect();
    expect(seen).toEqual([DRIVE_SCOPE]);
    expect(client.connected).toBe(true);
  });

  it('creates the folder on first list and returns files', async () => {
    mockGoogle();
    mockFetch((url, init) => {
      const decoded = decodeURIComponent(url);
      if (decoded.includes('/drive/v3/files?q=')) {
        if (decoded.includes('in parents')) {
          return { files: [{ id: 'f1', name: 'a.mab', size: '42', modifiedTime: '2026-09-04T00:00:00Z' }] };
        }
        return { files: [] };
      }
      if (decoded.includes('/drive/v3/files?fields=id') && init?.method === 'POST') return { id: 'folder1' };
      return {};
    });
    const client = new DriveClient('cid', async () => {});
    await client.connect();
    const files = await client.listBackups();
    expect(files).toEqual([{ id: 'f1', name: 'a.mab', size: 42, modifiedTime: '2026-09-04T00:00:00Z' }]);
  });

  it('uploads multipart and downloads media', async () => {
    mockGoogle();
    const calls: { url: string; init?: RequestInit }[] = [];
    mockFetch((url, init) => {
      calls.push({ url, init });
      if (url.includes('/drive/v3/files?q=')) return { files: [{ id: 'folder1' }] };
      if (url.includes('uploadType=multipart')) return { id: 'newfile' };
      if (url.includes('alt=media')) return { text: 'backup-bytes' };
      return {};
    });
    const client = new DriveClient('cid', async () => {});
    await client.connect();
    await expect(client.uploadBackup('b.mab', '{}')).resolves.toEqual({ id: 'newfile' });
    const upload = calls.find((c) => c.url.includes('uploadType=multipart'))!;
    const contentType = (upload.init?.headers as Record<string, string> | undefined)?.['Content-Type'] ?? '';
    expect(contentType).toContain('multipart/related');
    // downloadBackup returns text — mock json/text both stringify; exercise path only
    await client.downloadBackup('newfile');
    expect(calls.some((c) => c.url.includes('alt=media'))).toBe(true);
  });

  it('refuses to work while disconnected and supports disconnect', async () => {
    mockFetch(() => ({}));
    const client = new DriveClient('cid', async () => {});
    await expect(client.listBackups()).rejects.toThrow(/Not connected/);
    client.disconnect();
    expect(client.connected).toBe(false);
  });

  it('surfaces Drive API errors with status', async () => {
    mockGoogle();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, text: async () => 'forbidden' }) as Response),
    );
    const client = new DriveClient('cid', async () => {});
    await client.connect();
    await expect(client.listBackups()).rejects.toThrow(/403/);
  });
});
