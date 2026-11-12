import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDocumentEditorGuard } from './useDocumentEditorGuard';

/**
 * Regression guard: a pristine document must NOT open "dirty".
 *
 * The editors derive values from an async list (the exchange rate follows the
 * currency list). If the dirty-guard takes its baseline before those defaults
 * land, the form shows "unsaved changes" on a document the user never
 * touched — and the browser warns when leaving it.
 */
describe('useDocumentEditorGuard', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('is not dirty while the editor is still hydrating', async () => {
    const { result } = renderHook(
      ({ ready, rate }) => useDocumentEditorGuard('doc', { rate }, false, false, false, ready),
      { initialProps: { ready: false, rate: 1 } }
    );

    // An async default lands while the editor is not ready yet.
    act(() => {
      result.current.clearDraft();
    });
    await waitFor(() => expect(result.current.isDirty).toBe(false));
    expect(result.current.isDirty).toBe(false);
  });

  it('takes the baseline after the editor becomes ready', async () => {
    const { result, rerender } = renderHook(
      ({ ready, rate }) => useDocumentEditorGuard('doc', { rate }, false, false, false, ready),
      { initialProps: { ready: false, rate: 1 } }
    );

    // The async default arrives before the editor is ready.
    rerender({ ready: false, rate: 1500 });
    await waitFor(() => expect(result.current.isDirty).toBe(false));

    // Now the editor is ready — the default must be part of the baseline.
    rerender({ ready: true, rate: 1500 });
    await waitFor(() => expect(result.current.isDirty).toBe(false));
    expect(result.current.isDirty).toBe(false);

    // A real edit after the baseline is taken DOES mark it dirty.
    rerender({ ready: true, rate: 1600 });
    await waitFor(() => expect(result.current.isDirty).toBe(true));
    expect(result.current.isDirty).toBe(true);
  });

  it('marks the document dirty after a real edit', async () => {
    const { result, rerender } = renderHook(
      ({ ready, name }) => useDocumentEditorGuard('doc', { name }, false, false, false, ready),
      { initialProps: { ready: true, name: '' } }
    );

    await waitFor(() => expect(result.current.isDirty).toBe(false));
    rerender({ ready: true, name: 'شركة الأمل' });
    await waitFor(() => expect(result.current.isDirty).toBe(true));
    expect(result.current.isDirty).toBe(true);
  });
});
