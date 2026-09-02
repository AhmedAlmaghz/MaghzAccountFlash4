import { useState, useEffect, useCallback } from 'react';

/**
 * Breakpoint definitions matching Tailwind v4 defaults (min-width, px).
 * Used by useBreakpoint / useIsMobile for JS-driven responsive behavior
 * (drawers, bottom sheets, card-mode tables).
 */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type BreakpointName = keyof typeof BREAKPOINTS;

/**
 * Reads window matchMedia safely. In non-browser environments (jsdom tests
 * without matchMedia) returns `fallback` so unit tests keep desktop layout.
 */
function matches(query: string, fallback: boolean): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return fallback;
  }
  try {
    return window.matchMedia(query).matches;
  } catch {
    return fallback;
  }
}

/**
 * Reactive media-query hook.
 * @param query CSS media query, e.g. '(min-width: 1024px)'
 * @param fallback value when matchMedia unavailable (default: false)
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const [value, setValue] = useState(() => matches(query, fallback));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(query);
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent) => setValue(e.matches);
    setValue(mql.matches);
    // Safari <14 compat: addListener
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return value;
}

/**
 * Reactive breakpoint hook — true when viewport is at or above the named
 * Tailwind breakpoint. Falls back to `true` (desktop) when matchMedia is
 * unavailable (jsdom tests), so existing desktop-rendered tests stay green.
 */
export function useBreakpoint(breakpoint: BreakpointName): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS[breakpoint]}px)`, true);
}

/**
 * Mobile detection for layout switching (drawer, bottom sheets, card tables).
 * Default: false (desktop) in jsdom — tests render desktop variants unchanged.
 */
export function useIsMobile(): boolean {
  return !useBreakpoint('lg');
}

/** Stable callback for imperative one-shot checks (event handlers). */
export function isMobileViewport(): boolean {
  return !matches(`(min-width: ${BREAKPOINTS.lg}px)`, false);
}

/**
 * Locks body scroll while `locked` is true (drawers, sheets).
 * Preserves scrollbar-gutter to avoid layout shift. SSR/jsdom safe.
 */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked || typeof document === 'undefined') return;
    const body = document.body;
    if (!body) return;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
    };
  }, [locked]);
}

/**
 * Escape-key handler with cleanup. Returns nothing; used by overlays.
 */
export function useEscapeKey(enabled: boolean, onEscape: () => void): void {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    },
    [onEscape]
  );
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, handler]);
}
