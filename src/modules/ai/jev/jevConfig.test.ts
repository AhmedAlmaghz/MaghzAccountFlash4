import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
}));

import { getJevConfig, JEV_SETTINGS_KEYS } from './jevConfig';
import { getDbAdapter } from '@/core/database/adapters';

const mockedGetDbAdapter = vi.mocked(getDbAdapter);

function mockSettings(rows: Array<{ key: string; value: string }>) {
  mockedGetDbAdapter.mockResolvedValue({
    query: vi.fn().mockResolvedValue({ success: true, rows }),
  } as unknown as Awaited<ReturnType<typeof getDbAdapter>>);
}

describe('jevConfig', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns disabled when no company', async () => {
    const cfg = await getJevConfig('');
    expect(cfg.enabled).toBe(false);
    expect(cfg.apiKey).toBeNull();
  });

  it('parses enabled + router + model', async () => {
    mockSettings([
      { key: JEV_SETTINGS_KEYS.enabled, value: 'true' },
      { key: JEV_SETTINGS_KEYS.apiKey, value: 'ts_test_123' },
      { key: JEV_SETTINGS_KEYS.model, value: 'jev-1.13.0' },
      { key: JEV_SETTINGS_KEYS.routerEnabled, value: 'true' },
    ]);
    const cfg = await getJevConfig('company-1');
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiKey).toBe('ts_test_123');
    expect(cfg.model).toBe('jev-1.13.0');
    expect(cfg.routerEnabled).toBe(true);
  });

  it('treats missing apiKey as disabled (no env)', async () => {
    mockSettings([]);
    const cfg = await getJevConfig('c1');
    expect(cfg.apiKey).toBeNull();
    expect(cfg.enabled).toBe(false);
  });

  it('returns plaintext apiKey', async () => {
    mockSettings([{ key: JEV_SETTINGS_KEYS.apiKey, value: 'plain-key' }]);
    const cfg = await getJevConfig('c1');
    expect(cfg.apiKey).toBe('plain-key');
  });
});
