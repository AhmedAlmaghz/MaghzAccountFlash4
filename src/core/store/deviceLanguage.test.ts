import { describe, it, expect, afterEach } from 'vitest';
import { detectDeviceLanguage } from './index';

const original = window.navigator.language;

function setNavigatorLanguage(value: string | undefined) {
  Object.defineProperty(window.navigator, 'language', {
    value,
    configurable: true,
  });
}

afterEach(() => {
  setNavigatorLanguage(original);
});

describe('detectDeviceLanguage', () => {
  it('detects Arabic devices', () => {
    setNavigatorLanguage('ar-YE');
    expect(detectDeviceLanguage()).toBe('ar');
    setNavigatorLanguage('ar');
    expect(detectDeviceLanguage()).toBe('ar');
  });
  it('detects English devices', () => {
    setNavigatorLanguage('en-US');
    expect(detectDeviceLanguage()).toBe('en');
    setNavigatorLanguage('en-GB');
    expect(detectDeviceLanguage()).toBe('en');
  });
  it('falls back to Arabic for anything else (product default)', () => {
    setNavigatorLanguage('fr-FR');
    expect(detectDeviceLanguage()).toBe('ar');
    setNavigatorLanguage('tr-TR');
    expect(detectDeviceLanguage()).toBe('ar');
  });
  it('falls back to Arabic when the API is missing', () => {
    setNavigatorLanguage(undefined as unknown as string);
    expect(detectDeviceLanguage()).toBe('ar');
  });
});
