import { useCallback } from 'react';
import type { PrintT } from '@/core/utils/printDocument';
import {
  printEditorDocument,
  exportEditorExcel,
  exportEditorPdf,
  type EditorDocumentData,
  type EditorLine,
} from '@/core/utils/documentExport';

/**
 * Print / Excel / PDF actions shared by every document editor.
 *
 * The data is assembled from the editor's LIVE form state, so the buttons
 * are useful before the document is saved (a draft can be previewed) and
 * after it is loaded — exactly like the old modal's detail view. All three
 * actions go through one `EditorDocumentData` shape, so a fix to the print
 * layout or the export columns applies to every editor.
 */
export function useDocumentExport(
  data: EditorDocumentData,
  t: PrintT,
): { onPrint: () => void; onExcel: () => void; onPdf: () => void } {
  const onPrint = useCallback(() => printEditorDocument(data, t), [data, t]);
  const onExcel = useCallback(() => exportEditorExcel(data, t), [data, t]);
  const onPdf = useCallback(() => void exportEditorPdf(data, t), [data, t]);
  return { onPrint, onExcel, onPdf };
}

export type { EditorDocumentData, EditorLine };
