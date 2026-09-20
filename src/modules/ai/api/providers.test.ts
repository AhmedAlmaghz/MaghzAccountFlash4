import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  PROVIDER_PRESETS,
  buildFailoverPlan,
  getProviderPreset,
  isTransientProviderError,
  isTransientProviderStatus,
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

describe('provider failover plan (B3)', () => {
  const primary = {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',
    apiKey: 'sk-primary',
    label: 'generativelanguage.googleapis.com',
  };

  it('classifies transient statuses and errors (and only those)', () => {
    expect(isTransientProviderStatus(429)).toBe(true);
    expect(isTransientProviderStatus(503)).toBe(true);
    expect(isTransientProviderStatus(529)).toBe(true);
    expect(isTransientProviderStatus(401)).toBe(false);
    expect(isTransientProviderStatus(404)).toBe(false);
    expect(isTransientProviderStatus(500)).toBe(false);
    expect(isTransientProviderError('LLM provider error (503): overloaded')).toBe(true);
    expect(isTransientProviderError('انتهت مهلة الاتصال بمزود الذكاء الاصطناعي (timeout)')).toBe(true);
    expect(isTransientProviderError('LLM provider error (401): invalid key')).toBe(false);
    expect(isTransientProviderError('invalid temperature')).toBe(false);
    expect(isTransientProviderError(null)).toBe(false);
  });

  it('builds a plan when the fallback is fully configured and different', () => {
    const plan = buildFailoverPlan(primary, {
      baseUrl: 'https://api.openai.com/v1/',
      model: 'gpt-4o-mini',
      apiKey: 'sk-fallback',
    });
    expect(plan?.fallback.label).toBe('api.openai.com');
    expect(plan?.fallback.model).toBe('gpt-4o-mini');
    expect(plan?.primary).toBe(primary);
  });

  it('refuses failover when fallback is missing, partial, or identical', () => {
    expect(buildFailoverPlan(primary, null)).toBeNull();
    expect(buildFailoverPlan(null, { baseUrl: 'https://x/v1', model: 'm', apiKey: 'k' })).toBeNull();
    expect(buildFailoverPlan(primary, { baseUrl: '', model: 'm', apiKey: 'k' })).toBeNull();
    expect(buildFailoverPlan(primary, { baseUrl: 'https://api.openai.com/v1', model: '', apiKey: 'k' })).toBeNull();
    expect(buildFailoverPlan(primary, { baseUrl: 'https://api.openai.com/v1', model: 'm', apiKey: '' })).toBeNull();
    // Same endpoint (host case-insensitive, trailing slash ignored) = engine retry territory, not failover.
    expect(
      buildFailoverPlan(primary, {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        model: 'gemini-2.0-flash',
        apiKey: 'sk-other',
      }),
    ).toBeNull();
    // Same host but different model IS a valid failover (quota per model).
    expect(
      buildFailoverPlan(primary, {
        baseUrl: primary.baseUrl,
        model: 'gemini-1.5-pro',
        apiKey: 'sk-other',
      }),
    ).not.toBeNull();
  });
});
