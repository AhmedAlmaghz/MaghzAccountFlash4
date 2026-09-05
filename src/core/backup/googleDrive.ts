/**
 * Google Drive backup target — minimal, lazy and memory-only.
 *
 * - The GIS script loads on first connect only (zero bundle cost).
 * - Scope is `drive.file`: the app sees ONLY files it created.
 * - The OAuth token lives in memory with its expiry; it is never written
 *   to localStorage/IndexedDB. Only the OAuth *client id* is persisted
 *   (settings table, per company) — it is public by design.
 * - Backups live in a visible `MaghzAccount Backups` folder so the user
 *   can see and manage them from drive.google.com too.
 */

export interface DriveFile {
  id: string;
  name: string;
  size: number;
  modifiedTime: string;
}

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_FOLDER_NAME = 'MaghzAccount Backups';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

type GisLoader = () => Promise<void>;

let gisPromise: Promise<void> | null = null;

export function resetGisForTests(): void {
  gisPromise = null;
}

const defaultGisLoader: GisLoader = () =>
  new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('No document'));
      return;
    }
    if (document.querySelector(`script[src="${GIS_SRC}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });

interface GoogleAccounts {
  oauth2: {
    initTokenClient: (config: {
      client_id: string;
      scope: string;
      callback: (resp: { access_token?: string; expires_in?: number; error?: string }) => void;
    }) => { requestAccessToken: () => void };
  };
}

function googleAccounts(): GoogleAccounts {
  const g = (window as unknown as { google?: { accounts?: GoogleAccounts['oauth2'] } }).google;
  if (!g?.accounts) throw new Error('Google Identity Services not loaded');
  return { oauth2: g.accounts };
}

async function driveFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`https://www.googleapis.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Drive request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res;
}

export class DriveClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private readonly clientId: string;
  private readonly gisLoader: GisLoader;

  constructor(clientId: string, gisLoader: GisLoader = defaultGisLoader) {
    this.clientId = clientId;
    this.gisLoader = gisLoader;
  }

  get connected(): boolean {
    return !!this.token && Date.now() < this.tokenExpiresAt;
  }

  /** Interactive connect — must be called from a user gesture (popup). */
  async connect(): Promise<void> {
    if (!this.clientId) throw new Error('Google client ID is not configured');
    if (!gisPromise) gisPromise = this.gisLoader();
    await gisPromise;
    const { access_token, expires_in, error } = await new Promise<{
      access_token?: string;
      expires_in?: number;
      error?: string;
    }>((resolve) => {
      googleAccounts().oauth2
        .initTokenClient({ client_id: this.clientId, scope: DRIVE_SCOPE, callback: resolve })
        .requestAccessToken();
    });
    if (error || !access_token) throw new Error(`Google sign-in failed: ${error ?? 'no token'}`);
    this.token = access_token;
    // Refresh a minute early — never send an expired token.
    this.tokenExpiresAt = Date.now() + Math.max(0, (expires_in ?? 3600) - 60) * 1000;
  }

  disconnect(): void {
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  private async auth(): Promise<string> {
    if (!this.connected || !this.token) throw new Error('Not connected to Google Drive');
    return this.token;
  }

  private async folderId(): Promise<string> {
    const token = await this.auth();
    const q = encodeURIComponent(
      `mimeType = 'application/vnd.google-apps.folder' and name = '${DRIVE_FOLDER_NAME}' and trashed = false`,
    );
    const found = await (
      await driveFetch(token, `/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`)
    ).json();
    if (found?.files?.[0]?.id) return found.files[0].id as string;
    const created = await (
      await driveFetch(token, '/drive/v3/files?fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
      })
    ).json();
    if (!created?.id) throw new Error('Could not create Drive folder');
    return created.id as string;
  }

  async listBackups(): Promise<DriveFile[]> {
    const token = await this.auth();
    const folder = await this.folderId();
    const q = encodeURIComponent(`'${folder}' in parents and trashed = false`);
    const data = await (
      await driveFetch(
        token,
        `/drive/v3/files?q=${q}&fields=files(id,name,size,modifiedTime)&pageSize=50&orderBy=modifiedTime desc`,
      )
    ).json();
    const files = Array.isArray(data?.files) ? data.files : [];
    return files.map((f: { id: string; name: string; size?: string; modifiedTime: string }) => ({
      id: f.id,
      name: f.name,
      size: Number(f.size ?? 0),
      modifiedTime: f.modifiedTime,
    }));
  }

  async uploadBackup(name: string, content: string): Promise<{ id: string }> {
    const token = await this.auth();
    const folder = await this.folderId();
    const boundary = `maghz${Date.now().toString(36)}`;
    const meta = JSON.stringify({ name, parents: [folder] });
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
      `--${boundary}--`;
    const data = await (
      await driveFetch(token, '/upload/drive/v3/files?uploadType=multipart&fields=id', {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      })
    ).json();
    if (!data?.id) throw new Error('Drive upload returned no file id');
    return { id: data.id as string };
  }

  async downloadBackup(fileId: string): Promise<string> {
    const token = await this.auth();
    return (await driveFetch(token, `/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`)).text();
  }

  async deleteBackup(fileId: string): Promise<void> {
    const token = await this.auth();
    await driveFetch(token, `/drive/v3/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  }
}
