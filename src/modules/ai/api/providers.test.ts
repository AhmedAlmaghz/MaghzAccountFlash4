import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  PROVIDER_PRESETS,
  getProviderPreset,
  resolveProviderId,
  validateModelForProvider,
} from './providers';

/**
 * B1: provider registry — one preset table shared by the settings UI and
 * the bridge validation (previously three drifting copies).
 */
describe('provider registry (B1)', () => {
  it('every preset id is rendered by AiSettingsPage and labelled in i18n', () => {
    const page = readFileSync(resolve(__dirname, '../components/AiSettingsPage.tsx'), 'utf-8');
    expect(page).toContain('PROVIDER_PRESETS');
    const root = resolve(__dirname, '../../../..');
    const ar = JSON.parse(readFileSync(resolve(root, 'src/core/i18n/ar.json'), 'utf-8'));
    const en = JSON.parse(readFileSync(resolve(root, 'src/core/i18n/en.json'), 'utf-8'));
    for (const p of PROVIDER_PRESETS) {
      expect(ar.ai.settings.presets[p.id], `ar label for ${p.id}`).toBeTruthy();
      expect(en.ai.settings.presets[p.id], `en label for ${p.id}`).toBeTruthy();
    }
  });

  it('gemini preset mirrors the pinned DEFAULT consts (no silent drift)', () => {
    const root = resolve(__dirname, '../../../..');
    const bridge = readFileSync(resolve(root, 'src/modules/ai/api/browserBridge.ts'), 'utf-8');
    const main = readFileSync(resolve(root, 'electron/aiHandler.js'), 'utf-8');
    const gemini = getProviderPreset('gemini');
    for (const src of [bridge, main]) {
      expect(src).toContain(`const DEFAULT_BASE_URL = '${gemini.baseUrl}/'`);
      expect(src).toContain(`const DEFAULT_MODEL = '${gemini.defaultModel}'`);
    }
  });

  it('every non-custom host is inside the SSRF allow-list', () => {
    const root = resolve(__dirname, '../../../..');
    const bridge = readFileSync(resolve(root, 'src/modules/ai/api/browserBridge.ts'), 'utf-8');
    for (const p of PROVIDER_PRESETS) {
      for (const host of p.hosts) {
        if (['localhost', '127.0.0.1', '::1'].includes(host)) continue;
        expect(bridge).toContain(`'${host}'`);
      }
    }
  });

  it('resolves providers by base-url host', () => {
    expect(resolveProviderId('https://generativelanguage.googleapis.com/v1beta/openai/')).toBe('gemini');
    expect(resolveProviderId('https://api.openai.com/v1')).toBe('openai');
    expect(resolveProviderId('https://openrouter.ai/api/v1')).toBe('openrouter');
    expect(resolveProviderId('https://api.groq.com/openai/v1')).toBe('groq');
    expect(resolveProviderId('http://localhost:11434/v1')).toBe('ollama');
    expect(resolveProviderId('https://llm.example.com/v1')).toBe('custom');
    expect(resolveProviderId('')).toBe('custom');
    expect(resolveProviderId('not-a-url')).toBe('custom');
  });

  it('accepts empty model (provider default) for every provider', () => {
    for (const p of PROVIDER_PRESETS) {
      expect(validateModelForProvider(p.id, '').ok).toBe(true);
      expect(validateModelForProvider(p.id, undefined).ok).toBe(true);
    }
  });

  it('accepts real catalog names and rejects the infamous fake', () => {
    expect(validateModelForProvider('gemini', 'gemini-2.0-flash').ok).toBe(true);
    expect(validateModelForProvider('gemini', 'gemini-1.5-pro').ok).toBe(true);
    const fake = validateModelForProvider('gemini', 'gemini-3.5-flash-lite');
    expect(fake.ok).toBe(false);
    expect(fake.errorAr).toContain('404');
    expect(validateModelForProvider('openai', 'gpt-4o-mini').ok).toBe(true);
    expect(validateModelForProvider('openai', 'gemini-2.0-flash').ok).toBe(false);
    expect(validateModelForProvider('openrouter', 'google/gemini-2.0-flash-001').ok).toBe(true);
    expect(validateModelForProvider('openrouter', 'gpt-4o-mini').ok).toBe(false);
  });

  it('ollama/custom accept any non-empty name (server-side catalog)', () => {
    expect(validateModelForProvider('ollama', 'qwen2.5:14b').ok).toBe(true);
    expect(validateModelForProvider('custom', 'anything-at-all').ok).toBe(true);
    expect(validateModelForProvider('unknown-id', 'whatever').ok).toBe(true);
  });
});
