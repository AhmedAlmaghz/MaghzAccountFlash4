import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePaginatedList } from './usePaginatedList';

interface Item { id: number; name: string }

describe('usePaginatedList', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('loads data on mount', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      success: true,
      data: { items: [{ id: 1, name: 'A' }], total: 1, page: 1, pageSize: 25, totalPages: 1 },
    });
    const { result } = renderHook(() => usePaginatedList<Item>(fetchFn, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual([{ id: 1, name: 'A' }]);
    expect(result.current.total).toBe(1);
    expect(fetchFn).toHaveBeenCalledWith(1, 25);
  });

  it('changes page', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      success: true,
      data: { items: [], total: 100, page: 1, pageSize: 25, totalPages: 4 },
    });
    const { result } = renderHook(() => usePaginatedList<Item>(fetchFn, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.goToPage(3));
    await waitFor(() => expect(result.current.page).toBe(3));
    expect(fetchFn).toHaveBeenLastCalledWith(3, 25);
  });

  it('clamps page to valid range', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      success: true,
      data: { items: [], total: 25, page: 1, pageSize: 25, totalPages: 1 },
    });
    const { result } = renderHook(() => usePaginatedList<Item>(fetchFn, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.goToPage(99));
    expect(result.current.page).toBe(1);
    act(() => result.current.goToPage(0));
    expect(result.current.page).toBe(1);
  });

  it('changes page size and resets page', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      success: true,
      data: { items: [], total: 200, page: 1, pageSize: 25, totalPages: 8 },
    });
    const { result } = renderHook(() => usePaginatedList<Item>(fetchFn, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.goToPage(5));
    await waitFor(() => expect(result.current.page).toBe(5));
    act(() => result.current.changePageSize(50));
    await waitFor(() => expect(result.current.pageSize).toBe(50));
    expect(result.current.page).toBe(1);
  });

  it('handles errors', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ success: false, error: 'boom' });
    const { result } = renderHook(() => usePaginatedList<Item>(fetchFn, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('boom');
    expect(result.current.items).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it('handles thrown errors (not response errors)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => usePaginatedList<Item>(fetchFn, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('network down');
    expect(result.current.items).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it('handles non-Error thrown values', async () => {
    const fetchFn = vi.fn().mockRejectedValue('plain string');
    const { result } = renderHook(() => usePaginatedList<Item>(fetchFn, []));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('plain string');
  });

  it('returns reset, setPage, setPageSize, and reload methods', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      success: true,
      data: { items: [], total: 200, page: 1, pageSize: 25, totalPages: 8 },
    });
    const { result } = renderHook(() =>
      usePaginatedList<Item>(fetchFn, [], { initialPage: 2, initialPageSize: 50 })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(typeof result.current.reset).toBe('function');
    expect(typeof result.current.setPage).toBe('function');
    expect(typeof result.current.setPageSize).toBe('function');
    expect(typeof result.current.reload).toBe('function');
  });
});
