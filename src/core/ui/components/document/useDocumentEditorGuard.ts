import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDocumentDraft } from './useDocumentDraft';
import { useUnsavedGuard } from './useUnsavedGuard';

/**
 * One-step document guard: draft autosave + dirty tracking (snapshot
 * compare) + unsaved-changes confirmation.
 *
 * Usage:
 *   const { blocked, proceed, reset, guardNavigate, clearDraft, isDirty } =
 *     useDocumentEditorGuard('sales-invoice', { customerId, date, lines }, loading, isEdit, saving);
 *
 * `ready` tells the guard when the editor is fully hydrated. An editor that
 * derives values from an async list (the exchange rate follows the currency
 * list) must pass it, otherwise the baseline is captured before the defaults
 * land — the form then opens "dirty" and the browser warns when the user
 * leaves a document they never touched.
 */
export function useDocumentEditorGuard<T extends Record<string, unknown>>(
  docKey: string,
  draft: T,
  loading: boolean,
  isEditing: boolean,
  _saving = false,
  ready?: boolean
) {
  const { clear } = useDocumentDraft(docKey, draft, isEditing);
  const initialRef = useRef<string | null>(null);
  const latestRef = useRef<string>('');
  const [isDirty, setIsDirty] = useState(false);

  const serialized = useMemo(() => JSON.stringify(draft), [draft]);
  const hydrated = ready ?? !loading;

  // Keep the newest serialization reachable from timers so the baseline can
  // be taken from the settled value, not the one of the render that armed it.
  useEffect(() => {
    latestRef.current = serialized;
  }, [serialized]);

  useEffect(() => {
    if (!hydrated) return;

    if (initialRef.current !== null) {
      setIsDirty(serialized !== initialRef.current);
      return;
    }

    // The pristine baseline is not taken yet. The editor may still be
    // applying async defaults — capture it on the next macrotask, by which
    // time React has committed those defaults, so the baseline INCLUDES them.
    const id = window.setTimeout(() => {
      initialRef.current = latestRef.current;
      setIsDirty(false);
    }, 0);
    return () => window.clearTimeout(id);
  }, [serialized, hydrated]);

  const guard = useUnsavedGuard(isDirty);

  const markSaved = useCallback(() => {
    setIsDirty(false);
    if (initialRef.current !== null) initialRef.current = serialized;
    clear();
  }, [serialized, clear]);

  return {
    ...guard,
    isDirty,
    clearDraft: markSaved,
  };
}
