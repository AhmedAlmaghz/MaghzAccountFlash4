import { useCallback, useEffect, useRef } from 'react';

function draftKey(docKey: string) {
  return `maghzaccount-draft-${docKey}`;
}

/**
 * Autosaves an in-progress document to localStorage and restores it on
 * mount. Call `clear()` after a successful save to drop the draft.
 */
export function useDocumentDraft<T extends Record<string, unknown>>(docKey: string, value: T, isEditing: boolean) {
  const key = draftKey(docKey);
  const restoredRef = useRef(false);
  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* best-effort */
    }
  }, [key]);

  // Restore once per mount when creating a new document.
  useEffect(() => {
    if (restoredRef.current || isEditing) return;
    restoredRef.current = true;
  }, [isEditing]);

  // Save on change (debounced via 300ms).
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* storage full/unavailable — ignore */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [key, value]);

  return { clear };
}

export function readDocumentDraft<T>(docKey: string): T | null {
  try {
    const raw = localStorage.getItem(draftKey(docKey));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
