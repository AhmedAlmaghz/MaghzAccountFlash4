import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteFromOpfs, listOpfs, opfsSupported, readFromOpfs, saveToOpfs } from './opfsStore';

function mockStorage(files: Map<string, { text: string; lastModified: number }>) {
  const dir = {
    getDirectoryHandle: vi.fn(async () => dir),
    getFileHandle: vi.fn(async (name: string, opts?: { create?: boolean }) => {
      if (!files.has(name)) {
        if (!opts?.create) throw new Error('NotFoundError');
        files.set(name, { text: '', lastModified: Date.now() });
      }
      return {
        kind: 'file',
        name,
        getFile: async () =>
          new File([files.get(name)!.text], name, { lastModified: files.get(name)!.lastModified }),
        createWritable: async () => ({
          write: async (text: string) => {
            files.set(name, { text, lastModified: Date.now() });
          },
          close: async () => {},
        }),
      };
    }),
    removeEntry: vi.fn(async (name: string) => {
      files.delete(name);
    }),
    values: async function* () {
      for (const [name] of files) {
        yield {
          kind: 'file',
          name,
          getFile: async () =>
            new File([files.get(name)!.text], name, { lastModified: files.get(name)!.lastModified }),
        };
      }
    },
  };
  Object.defineProperty(navigator, 'storage', { value: { getDirectory: async () => dir }, configurable: true });
  return dir;
}

describe('opfsStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports unsupported when the API is missing', () => {
    Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
    expect(opfsSupported()).toBe(false);
  });

  it('saves, lists (newest first), reads and deletes', async () => {
    mockStorage(new Map());
    expect(opfsSupported()).toBe(true);

    await saveToOpfs('a.mab', '{"a":1}');
    await saveToOpfs('b.mab', '{"b":2}');
    const list = await listOpfs();
    expect(list.map((f) => f.name)).toEqual(['b.mab', 'a.mab']);
    expect(list[0].size).toBeGreaterThan(0);
    expect(await readFromOpfs('a.mab')).toBe('{"a":1}');

    await deleteFromOpfs('a.mab');
    expect((await listOpfs()).map((f) => f.name)).toEqual(['b.mab']);
  });

  it('listOpfs degrades to empty when the directory is missing', async () => {
    const dir = {
      getDirectoryHandle: vi.fn(async () => {
        throw new Error('NotFoundError');
      }),
    };
    Object.defineProperty(navigator, 'storage', { value: { getDirectory: async () => dir }, configurable: true });
    expect(await listOpfs()).toEqual([]);
  });
});
