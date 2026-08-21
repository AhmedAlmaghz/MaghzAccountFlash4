import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * Guard يمنع تخزين كلمات مرور صلبة أو fallback في كود المصدر الملتزم.
 */

const ROOT = path.resolve(__dirname, '../../..');

function readRelative(relPath: string): string {
  try {
    return readFileSync(path.join(ROOT, relPath), 'utf-8');
  } catch {
    return '';
  }
}

describe('security: no hardcoded DB password fallback in tracked config', () => {
  it('drizzle.config.ts has no non-empty password fallback', () => {
    const cfg = readRelative('drizzle.config.ts');
    expect(cfg).not.toMatch(/password\s*:\s*[^\n]*'[^']+'/);
  });

  it('drizzle.check.config.ts has no non-empty password fallback', () => {
    const cfg = readRelative('drizzle.check.config.ts');
    expect(cfg).not.toMatch(/password\s*:\s*[^\n]*'[^']+'/);
  });
});
