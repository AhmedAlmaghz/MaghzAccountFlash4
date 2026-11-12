import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUnsavedGuard } from './useUnsavedGuard';

/**
 * Regression guard: the unsaved-changes guard must work under a NON-data
 * router. `useBlocker` (react-router v7) throws "useBlocker must be used
 * within a data router" under <BrowserRouter> — the app uses BrowserRouter,
 * so every editor page crashed on mount. This hook must not depend on it.
 */
describe('useUnsavedGuard', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not require a data router (no useBlocker crash)', () => {
    expect(() => renderHook(() => useUnsavedGuard(false))).not.toThrow();
  });

  it('runs the action immediately when not dirty', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useUnsavedGuard(false));
    act(() => result.current.guardNavigate(fn));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.blocked).toBe(false);
  });

  it('blocks the action when dirty and runs it only after proceed', async () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useUnsavedGuard(true));
    act(() => result.current.guardNavigate(fn));
    expect(fn).not.toHaveBeenCalled();
    expect(result.current.blocked).toBe(true);
    // proceed() defers the navigation by a tick so the guard can unmount
    // before the navigation lands.
    await act(async () => {
      result.current.proceed();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancels on reset', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useUnsavedGuard(true));
    act(() => result.current.guardNavigate(fn));
    act(() => result.current.reset());
    expect(fn).not.toHaveBeenCalled();
    expect(result.current.blocked).toBe(false);
  });

  it('registers a beforeunload listener while dirty', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderHook(() => useUnsavedGuard(true));
    const hasBeforeUnload = addSpy.mock.calls.some((c) => c[0] === 'beforeunload');
    expect(hasBeforeUnload).toBe(true);
  });
});
