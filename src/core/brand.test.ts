import { describe, it, expect } from 'vitest';
import { APP_VERSION, APP_VERSION_LABEL } from './brand';

describe('brand version (dynamic, never hard-coded)', () => {
  it('exposes a non-empty version string', () => {
    expect(typeof APP_VERSION).toBe('string');
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });

  it('falls back to a dev marker when the bundler define is absent (unit tests)', () => {
    expect(APP_VERSION).toBe('0.0.0-dev');
  });

  it('label is always v-prefixed and untranslated', () => {
    expect(APP_VERSION_LABEL).toBe(`v${APP_VERSION}`);
    expect(APP_VERSION_LABEL.startsWith('v')).toBe(true);
  });
});
