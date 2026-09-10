import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Provider defaults drift gate.
 *
 * DEFAULT_BASE_URL / DEFAULT_MODEL / DEFAULT_PROVIDER live in TWO parallel
 * implementations (Electron main process + PGlite browser bridge). They were
 * duplicated rather than shared, so they drift silently — the worst incident
 * being the default model 'gemini-3.5-flash-lite', a model that never existed
 * in the Gemini catalog: every unconfigured install 404'd until the user set
 * a model by hand. This gate reads both files as text and pins the trio so
 * the next rename cannot land on one side only.
 */

const root = resolve(__dirname, '../../../../..');
const electronHandler = readFileSync(resolve(root, 'electron/aiHandler.js'), 'utf-8');
const browserBridge = readFileSync(resolve(root, 'src/modules/ai/api/browserBridge.ts'), 'utf-8');

function extractConst(source: string, name: string): string {
  const m = source.match(new RegExp(`const ${name} = '([^']+)'`));
  if (!m) throw new Error(`const ${name} not found`);
  return m[1];
}

describe('AI provider defaults parity (electron/aiHandler.js ↔ browserBridge.ts)', () => {
  it('both layers default to the same base URL', () => {
    expect(extractConst(browserBridge, 'DEFAULT_BASE_URL')).toBe(
      extractConst(electronHandler, 'DEFAULT_BASE_URL'),
    );
  });

  it('both layers default to the same model', () => {
    expect(extractConst(browserBridge, 'DEFAULT_MODEL')).toBe(
      extractConst(electronHandler, 'DEFAULT_MODEL'),
    );
  });

  it('the default model is a real Gemini catalog model', () => {
    // Regression pin: 'gemini-3.5-flash-lite' never existed and 404'd every
    // unconfigured install. If you change the default, change it to another
    // REAL model name.
    expect(extractConst(electronHandler, 'DEFAULT_MODEL')).toMatch(/^gemini-\d+\.\d+-[a-z-]+$/);
    expect(extractConst(electronHandler, 'DEFAULT_MODEL')).not.toContain('3.5');
  });

  it('both layers report the same default provider label (gemini)', () => {
    // Default base URL IS Gemini's OpenAI-compatible endpoint — 'openai'
    // (the old main-process label) misled users about which service they
    // were talking to.
    expect(electronHandler).toContain(`settings[PROVIDER_SETTING] || 'gemini'`);
    expect(browserBridge).toContain(`settings[PROVIDER_SETTING] || 'gemini'`);
  });

  it('both layers save message attachments as [] (never explicit NULL)', () => {
    // ai_chat_messages.attachments is NOT NULL DEFAULT '[]' — an explicit
    // NULL violates the constraint and killed every session save for
    // messages without attachments.
    expect(electronHandler).toContain(`: '[]'`);
    expect(browserBridge).toContain(`: '[]'`);
    expect(electronHandler).not.toMatch(/JSON\.stringify\(m\.attachments\) : null/);
    expect(browserBridge).not.toMatch(/JSON\.stringify\(m\.attachments\) : null/);
  });

  it('both layers enforce the same provider host allow-list', () => {
    for (const host of [
      'api.openai.com',
      'openrouter.ai',
      'api.groq.com',
      'generativelanguage.googleapis.com',
    ]) {
      expect(electronHandler).toContain(`'${host}'`);
      expect(browserBridge).toContain(`'${host}'`);
    }
  });
});
