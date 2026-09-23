import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./jevConfig', () => ({
  getJevConfig: vi.fn().mockResolvedValue({
    enabled: true, apiKey: 'ts_test', routerEnabled: true, guardEnabled: false,
    model: 'jev-latest', baseUrl: 'https://api.typesafe.ai',
  }),
  JEV_DEFAULT_BASE_URL: 'https://api.typesafe.ai',
  JEV_DEFAULT_MODEL: 'jev-latest',
}));

const systemOneMock = vi.fn();
vi.mock('@typesafe-ai/sdk', () => ({
  // Must be constructible (`new TypeSafeClient(...)` in getJevClient).
  TypeSafeClient: vi.fn(function (this: unknown) {
    return { systemOne: systemOneMock };
  }),
}));

import { jevSystemOne } from './jevClient';
import { getLastJevTransport } from './jevMetrics';

const QUESTIONS = { q: { type: 'noul', instructions: 'Is it?' } } as never;

describe('jevClient transport selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as Record<string, unknown>).electronAI;
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAI;
    vi.unstubAllGlobals();
  });

  it('prefers the main-process proxy in Electron and never touches direct fetch', async () => {
    const proxy = vi.fn().mockResolvedValue({
      success: true,
      data: { model: 'jev-1.13.0', answers: { q: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 10, output_tokens: 0 } },
    });
    (window as unknown as Record<string, unknown>).electronAI = { jevSystemOne: proxy };
    const res = await jevSystemOne('c1', { state: 'x', questions: QUESTIONS }, { label: 't-proxy' });
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0][0]).toMatchObject({ model: 'jev-latest', baseUrl: 'https://api.typesafe.ai', apiKey: 'ts_test' });
    expect(res).toMatchObject({ model: 'jev-1.13.0' });
    expect(systemOneMock).not.toHaveBeenCalled();
    expect(getLastJevTransport()?.via).toBe('main-proxy');
  });

  it('falls back to direct SDK fetch when no proxy is exposed', async () => {
    systemOneMock.mockResolvedValue({
      model: 'jev-1.13.0',
      answers: { q: { type: 'noul', noul: 0.4 } },
      usage: { input_tokens: 10, output_tokens: 0 },
    });
    const res = await jevSystemOne('c1', { state: 'x', questions: QUESTIONS }, { label: 't-direct' });
    expect(systemOneMock).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ model: 'jev-1.13.0' });
    expect(getLastJevTransport()?.via).toBe('direct');
  });

  it('uses the same-origin relay in browsers when present (no CORS)', async () => {
    const relayData = {
      model: 'jev-1.13.0',
      answers: { q: { type: 'noul', noul: 0.7 } },
      usage: { input_tokens: 5, output_tokens: 0 },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => relayData,
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await jevSystemOne('c1', { state: 'x', questions: QUESTIONS }, { label: 't-relay' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/jev-systemone');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: 'jev-latest', apiKey: 'ts_test' });
    expect(systemOneMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({ model: 'jev-1.13.0' });
    expect(getLastJevTransport()?.via).toBe('relay');
  });

  it('skips a non-JSON relay (static host without the function) and falls back to direct', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      json: async () => { throw new Error('not json'); },
    }));
    systemOneMock.mockResolvedValue({
      model: 'jev-1.13.0',
      answers: { q: { type: 'noul', noul: 0.4 } },
      usage: { input_tokens: 10, output_tokens: 0 },
    });
    const res = await jevSystemOne('c1', { state: 'x', questions: QUESTIONS }, { label: 't-relay-miss' });
    expect(systemOneMock).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ model: 'jev-1.13.0' });
  });

  it('proxy failure is final (no double-billing direct retry)', async () => {
    const proxy = vi.fn().mockResolvedValue({ success: false, error: 'JEV provider error (401): bad key' });
    (window as unknown as Record<string, unknown>).electronAI = { jevSystemOne: proxy };
    const res = await jevSystemOne('c1', { state: 'x', questions: QUESTIONS }, { label: 't-final' });
    expect(res).toBeNull();
    expect(systemOneMock).not.toHaveBeenCalled();
  });
});
