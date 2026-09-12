import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Stage-3 feature gates for the operational hardening (Phase 2.4 + 2.6 + 2.3).
 *
 * The rate limiter, the PII purge channel and the VAT-null rule live in the
 * Electron main process (plain JS, no exports) and its browser-bridge mirror,
 * so unit-testing the functions directly is impossible. Like
 * providerDefaults.test.ts, this gate reads both files as text and pins the
 * security-critical contracts: anyone who "simplifies" them breaks CI here.
 */

const root = resolve(__dirname, '../../../..');
const main = readFileSync(resolve(root, 'electron/aiHandler.js'), 'utf-8');
const bridge = readFileSync(resolve(root, 'src/modules/ai/api/browserBridge.ts'), 'utf-8');
const shared = readFileSync(
  resolve(root, 'src/modules/ai/tools/writeTools/shared.ts'),
  'utf-8',
);

describe('AI operational guards (rate-limit + purge + VAT-null)', () => {
  it('rate limiter: 120/hour sliding window, per user+company, configurable via ai.rate_limit_hour', () => {
    expect(main).toContain('AI_RATE_LIMIT_HOUR = 120');
    expect(main).toContain('ai.rate_limit_hour');
    // Peek/record split: failures and timeouts must not burn quota.
    expect(main).toContain('isRateLimited');
    expect(main).toContain('recordProviderCall');
    // Sliding window of timestamps, not a naive counter
    expect(main).toContain('3600_000');
    // Arabic honesty message on exhaustion
    expect(main).toContain('انتهت حصة الذكاء الاصطناعي');
  });

  it('API key cache expires (no serve-forever after external rotation)', () => {
    expect(main).toContain('API_KEY_CACHE_TTL_MS');
  });

  it('PII purge channel exists on both layers with retention default 90 days', () => {
    expect(main).toContain('ai:purge-old-sessions');
    expect(bridge).toContain('purgeOldSessions');
    // Retention window default (0 = keep forever is the documented opt-out)
    expect(main + bridge).toContain('90');
  });

  it("P1: retention '0' (keep forever) short-circuits deletion on both layers", () => {
    // The old `days > 0 ? days : 90` deleted transcripts against an explicit
    // opt-out. Both transports must return early with purged: 0.
    for (const [, src] of [['main', main], ['bridge', bridge]] as const) {
      expect(src).toMatch(/days === 0/);
      expect(src).toMatch(/keptForever/);
    }
  });

  it('batch updates stay tenant-scoped (company_id on every PK write)', () => {
    // The golden rule: no UPDATE/DELETE by PK without AND company_id.
    // Spot-check the batch item paths on both layers.
    for (const src of [main, bridge]) {
      expect(src).toContain('company_id');
    }
    // Purge itself must be scoped — never a global DELETE.
    expect(main).toMatch(/ai:purge-old-sessions[\s\S]{0,2000}company_id/);
  });

  it('VAT is never invented: getVatRate returns null on unreadable settings (no silent 15%)', () => {
    expect(shared).toContain('Returns null when settings are unreadable');
    expect(shared).toContain('vatUnset');
    // No hardcoded 15 fallback in the shared tax path
    expect(shared).not.toMatch(/return 15[^0-9]/);
    expect(shared).not.toMatch(/\?\? 15[^0-9]/);
  });

  it('attachment extraction stays injection-framed (BEGIN/END fence + untrusted header)', async () => {
    const llmParts = readFileSync(
      resolve(root, 'src/modules/ai/engine/llmParts.ts'),
      'utf-8',
    );
    expect(llmParts).toContain('BEGIN_ATTACHMENT');
    expect(llmParts).toContain('END_ATTACHMENT');
    expect(llmParts).toMatch(/غير موثوق|UNTRUSTED|غير الموثوق|بيانات/i);
  });
});
