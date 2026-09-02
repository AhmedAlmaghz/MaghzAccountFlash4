import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  useMediaQuery,
  useBreakpoint,
  useIsMobile,
  useBodyScrollLock,
  useEscapeKey,
  isMobileViewport,
} from './useResponsive';

type MQL = {
  matches: boolean;
  addEventListener?: (t: string, cb: (e: { matches: boolean }) => void) => void;
  removeEventListener?: (t: string, cb: (e: { matches: boolean }) => void) => void;
  addListener?: (cb: (e: { matches: boolean }) => void) => void;
  removeListener?: (cb: (e: { matches: boolean }) => void) => void;
};

function mockMatchMedia(
  initial: (query: string) => boolean
): { trigger: (query: string, matches: boolean) => void } {
  const listeners = new Map<string, Set<(e: { matches: boolean }) => void>>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string): MQL => {
      return {
        matches: initial(query),
        addEventListener: (_t, cb) => {
          if (!listeners.has(query)) listeners.set(query, new Set());
          listeners.get(query)!.add(cb);
        },
        removeEventListener: (_t, cb) => {
          listeners.get(query)?.delete(cb);
        },
      };
    })
  );
  return {
    trigger: (query, matches) => {
      listeners.get(query)?.forEach((cb) => cb({ matches }));
    },
  };
}

describe('useResponsive', () => {
  it('returns fallback when matchMedia is unavailable (jsdom guard)', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)', false));
    expect(result.current).toBe(false);
    const { result: bp } = renderHook(() => useBreakpoint('lg'));
    expect(bp.current).toBe(true); // fallback=true for breakpoints
    vi.unstubAllGlobals();
  });

  it('useBreakpoint reflects media query state', () => {
    const { trigger } = mockMatchMedia(() => true);
    const { result } = renderHook(() => useBreakpoint('md'));
    expect(result.current).toBe(true);
    act(() => trigger('(min-width: 768px)', false));
    expect(result.current).toBe(false);
    vi.unstubAllGlobals();
  });

  it('useIsMobile is true when viewport is below lg', () => {
    mockMatchMedia((q) => !q.includes('1024'));
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
    vi.unstubAllGlobals();
  });

  it('useIsMobile is false at/above lg', () => {
    mockMatchMedia((q) => q.includes('1024'));
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    vi.unstubAllGlobals();
  });

  it('isMobileViewport imperative check', () => {
    mockMatchMedia((q) => !q.includes('1024'));
    expect(isMobileViewport()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('useBodyScrollLock locks and restores body overflow', () => {
    const { rerender } = renderHook(({ locked }) => useBodyScrollLock(locked), {
      initialProps: { locked: false },
    });
    expect(document.body.style.overflow).toBe('');
    rerender({ locked: true });
    expect(document.body.style.overflow).toBe('hidden');
    rerender({ locked: false });
    expect(document.body.style.overflow).toBe('');
  });

  it('useEscapeKey fires callback on Escape only when enabled', () => {
    const onEscape = vi.fn();
    const { rerender } = renderHook(({ enabled }) => useEscapeKey(enabled, onEscape), {
      initialProps: { enabled: false },
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onEscape).not.toHaveBeenCalled();
    rerender({ enabled: true });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
