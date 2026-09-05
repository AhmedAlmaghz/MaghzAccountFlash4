/**
 * OPFS (Origin Private File System) store for automatic backups.
 *
 * Best practice for silent auto-backups: the browser cannot pop a download
 * dialog unattended, so scheduled backups live in OPFS and the user
 * downloads / restores / prunes them on demand from the Backup page.
 * Feature-detected — when unavailable the auto-backup toggle is disabled
 * with an explanation instead of failing silently.
 */

export interface OpfsFileInfo {
  name: string;
  size: number;
  modifiedAt: string;
}

export const OPFS_BACKUP_DIR = 'maghz-backups';

type StorageLike = {
  getDirectory: () => Promise<DirLike>;
};
type DirLike = {
  getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<DirLike>;
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FileHandleLike>;
  removeEntry: (name: string) => Promise<void>;
  values: () => AsyncIterable<FileHandleLike | DirLike>;
};
type FileHandleLike = {
  kind: string;
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
};

function storage(): StorageLike | null {
  try {
    const nav = navigator as Navigator & { storage?: StorageLike };
    if (nav.storage && typeof nav.storage.getDirectory === 'function') return nav.storage;
  } catch {
    // non-browser context
  }
  return null;
}

export function opfsSupported(): boolean {
  return storage() !== null;
}

async function backupDir(create: boolean): Promise<DirLike | null> {
  const store = storage();
  if (!store) return null;
  try {
    const root = await store.getDirectory();
    return await root.getDirectoryHandle(OPFS_BACKUP_DIR, { create });
  } catch {
    return null;
  }
}

function isFileHandle(h: FileHandleLike | DirLike): h is FileHandleLike {
  return (h as FileHandleLike).kind === 'file';
}

export async function saveToOpfs(name: string, text: string): Promise<{ size: number }> {
  const dir = await backupDir(true);
  if (!dir) throw new Error('OPFS unavailable');
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  const file = await handle.getFile();
  return { size: file.size };
}

export async function listOpfs(): Promise<OpfsFileInfo[]> {
  const dir = await backupDir(false);
  if (!dir) return [];
  const out: OpfsFileInfo[] = [];
  try {
    for await (const handle of dir.values()) {
      if (!isFileHandle(handle)) continue;
      try {
        const file = await handle.getFile();
        out.push({ name: handle.name, size: file.size, modifiedAt: new Date(file.lastModified).toISOString() });
      } catch {
        // unreadable entry — skip, never fail the whole listing
      }
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
}

export async function readFromOpfs(name: string): Promise<string> {
  const dir = await backupDir(false);
  if (!dir) throw new Error('OPFS unavailable');
  const handle = await dir.getFileHandle(name);
  if (!isFileHandle(handle)) throw new Error('Not a file');
  return (await handle.getFile()).text();
}

export async function deleteFromOpfs(name: string): Promise<void> {
  const dir = await backupDir(false);
  if (!dir) throw new Error('OPFS unavailable');
  await dir.removeEntry(name);
}
