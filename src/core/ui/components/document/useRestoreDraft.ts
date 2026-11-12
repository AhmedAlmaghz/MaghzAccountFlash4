import { useEffect, useRef } from 'react';
import { readDocumentDraft } from './useDocumentDraft';

/**
 * Restores a previously autosaved draft when OPENING a new document
 * (not when editing an existing one). Best-effort: a missing or malformed
 * draft is silently ignored.
 *
 * Usage:
 *   useRestoreDraft('sales-invoice', isEdit, {
 *     customerId: setCustomerId,
 *     date: setDate,
 *     lines: setLines,
 *   });
 */
export function useRestoreDraft(
  docKey: string,
  isEditing: boolean,
  setters: Record<string, (value: never) => void>
) {
  const restoredRef = useRef(false);

  useEffect(() => {
    if (restoredRef.current || isEditing) return;
    restoredRef.current = true;
    const saved = readDocumentDraft<Record<string, unknown>>(docKey);
    if (!saved) return;
    for (const [key, setter] of Object.entries(setters)) {
      const value = saved[key];
      if (value !== undefined && value !== null) (setter as (v: unknown) => void)(value);
    }
  }, [docKey, isEditing, setters]);
}
