import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUERY_TIMEOUT_MS,
  MainThreadTransport,
  mainThreadTransport,
  withQueryTimeout,
} from './pgliteTransport';

/**
 * Transport slice-1 equivalence lock: the seam exists with zero behaviour
 * change. The singleton moved (not copied) so there is still exactly one
 * PGlite owner; the timeout helper is tested standalone and NOT wired into
 * any query path yet.
 */
describe('pgliteTransport slice-1', () => {
  it('exposes the query ceiling constant', () => {
    expect(DEFAULT_QUERY_TIMEOUT_MS).toBe(30_000);
  });

  it('passes fast promises through', async () => {
    await expect(withQueryTimeout(Promise.resolve(7), 1000, 'fast')).resolves.toBe(7);
  });

  it('rejects hung promises with a named timeout', async () => {
    const hung = new Promise<never>(() => {});
    await expect(withQueryTimeout(hung, 20, 'q')).rejects.toThrow('q timed out after 0.02s');
  });

  it('MainThreadTransport implements the seam', () => {
    const t = new MainThreadTransport();
    expect(typeof t.queryRaw).toBe('function');
    expect(typeof t.execRaw).toBe('function');
    expect(mainThreadTransport).toBeInstanceOf(MainThreadTransport);
  });
});
