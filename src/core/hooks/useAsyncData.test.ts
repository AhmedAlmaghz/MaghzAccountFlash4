import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAsyncData } from './useAsyncData';

describe('useAsyncData', () => {
  it('initializes with isLoading=false when enabled=false (infinite loading fix)', () => {
    const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
    const { result } = renderHook(() => useAsyncData(fetcher, [], false));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('starts loading after mount with enabled=true', async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 42 });
    const { result } = renderHook(() => useAsyncData(fetcher, []));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual({ value: 42 });
  });

  it('does not fetch when enabled=false (fix for infinite loading bug)', async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 1 });
    const { result } = renderHook(() => useAsyncData(fetcher, [], false));

    await new Promise((r) => setTimeout(r, 50));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
  });

  it('switches isLoading from false→true→false as data loads', async () => {
    let resolveFn: (val: { ok: true }) => void;
    const fetcher = vi.fn(() => new Promise<{ ok: true }>((resolve) => {
      resolveFn = resolve;
    }));
    const { result } = renderHook(() => useAsyncData(fetcher, []));

    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveFn!({ ok: true });
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toEqual({ ok: true });
  });

  it('sets error and stops loading on rejection', async () => {
    const err = new Error('boom');
    const fetcher = vi.fn().mockRejectedValue(err);
    const { result } = renderHook(() => useAsyncData(fetcher, []));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error).toBe(err);
    expect(result.current.data).toBeNull();
  });

  it('wraps non-Error rejections into Error objects', async () => {
    const fetcher = vi.fn().mockRejectedValue('string-error');
    const { result } = renderHook(() => useAsyncData(fetcher, []));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('string-error');
  });

  it('re-fetches when deps change', async () => {
    const fetcher = vi.fn().mockResolvedValue({ v: 1 });
    const { result, rerender } = renderHook(
      ({ dep }: { dep: number }) => useAsyncData(fetcher, [dep]),
      { initialProps: { dep: 1 } },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual({ v: 1 });
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    rerender({ dep: 2 });
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  it('reload() re-triggers the fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue({ v: 1 });
    const { result } = renderHook(() => useAsyncData(fetcher, []));

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.reload();
    });

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  it('cancels stale fetches when component unmounts (no setState on unmounted)', async () => {
    let resolveFn: (val: { ok: true }) => void;
    const fetcher = vi.fn(() => new Promise<{ ok: true }>((resolve) => {
      resolveFn = resolve;
    }));
    const { result, unmount } = renderHook(() => useAsyncData(fetcher, []));
    expect(result.current.isLoading).toBe(true);

    unmount();
    await act(async () => {
      resolveFn!({ ok: true });
    });
  });

  it('toggles from enabled=false to true triggers fetch', async () => {
    const fetcher = vi.fn().mockResolvedValue({ v: 1 });
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useAsyncData(fetcher, [], enabled),
      { initialProps: { enabled: false } },
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);

    rerender({ enabled: true });

    await waitFor(() => {
      expect(result.current.data).toEqual({ v: 1 });
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
