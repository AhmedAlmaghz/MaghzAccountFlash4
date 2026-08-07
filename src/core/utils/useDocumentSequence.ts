import { useCallback } from 'react';
import { getNextDocumentNumber } from '@/core/api';

export function useDocumentSequence() {
  const getNextNumber = useCallback(async (
    documentType: string,
    companyId: string
  ): Promise<{ success: boolean; number?: string; error?: string }> => {
    if (!companyId) {
      return { success: false, error: 'معرّف الشركة مطلوب لتوليد رقم المستند' };
    }
    return getNextDocumentNumber(companyId, documentType);
  }, []);

  return { getNextNumber };
}

export default useDocumentSequence;
