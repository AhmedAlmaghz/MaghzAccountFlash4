import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Unsaved-changes guard that does NOT depend on React Router's data router.
 *
 * `useBlocker` (react-router v7) throws "useBlocker must be used within a
 * data router" under `<BrowserRouter>` — the app uses BrowserRouter/HashRouter,
 * so every editor page would crash on mount. This guard implements the same
 * behaviour without a data router:
 *
 *  1. `beforeunload` — browser tab close / reload.
 *  2. `popstate`     — browser Back/Forward (the URL is pushed back so the
 *                      user stays where they were).
 *  3. link clicks    — captured at the document level so sidebar links and
 *                      any in-app anchor are covered too.
 *
 * The caller routes its own "leave" action through `guardNavigate(fn)`.
 */
export interface UnsavedGuard {
  isDirty: boolean;
  /** True while the confirmation dialog should be visible. */
  blocked: boolean;
  /** Leave anyway (dialog confirm). */
  proceed: () => void;
  /** Stay on the page (dialog cancel). */
  reset: () => void;
  /** Run `fn` now, or ask for confirmation first when dirty. */
  guardNavigate: (fn: () => void) => void;
}

export function useUnsavedGuard(isDirty: boolean): UnsavedGuard {
  const [blocked, setBlocked] = useState(false);
  const pendingRef = useRef<(() => void) | null>(null);
  const dirtyRef = useRef(isDirty);

  // Mirror the dirty flag into a ref for the imperative paths
  // (guardNavigate / proceed). Writing it during render is forbidden by the
  // react-hooks/refs rule — an effect is the safe place, and by the time a
  // click handler runs, the effect has already flushed.
  useEffect(() => {
    dirtyRef.current = isDirty;
  }, [isDirty]);

  // 1) Browser close / reload.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // 2) Browser Back/Forward — restore the current URL and ask.
  useEffect(() => {
    if (!isDirty) return;
    const handler = () => {
      // The router already moved; put the user back and let them decide.
      window.history.pushState(null, '', window.location.href);
      pendingRef.current = () => window.history.back();
      setBlocked(true);
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [isDirty]);

  // 3) In-app links (sidebar, breadcrumbs, …).
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      if (!href || href.startsWith('#') || anchor.target === '_blank') return;
      if (anchor.origin && anchor.origin !== window.location.origin) return;
      e.preventDefault();
      pendingRef.current = () => { anchor.click(); };
      setBlocked(true);
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [isDirty]);

  const proceed = useCallback(() => {
    const action = pendingRef.current;
    pendingRef.current = null;
    setBlocked(false);
    // Let the guard unmount before the navigation lands, otherwise the
    // popstate/link handlers would immediately block it again.
    dirtyRef.current = false;
    window.setTimeout(() => action?.(), 0);
  }, []);

  const reset = useCallback(() => {
    pendingRef.current = null;
    setBlocked(false);
  }, []);

  const guardNavigate = useCallback((fn: () => void) => {
    if (!dirtyRef.current) {
      fn();
      return;
    }
    pendingRef.current = fn;
    setBlocked(true);
  }, []);

  return { isDirty, blocked, proceed, reset, guardNavigate };
}
