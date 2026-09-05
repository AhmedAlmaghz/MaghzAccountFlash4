import { useAppStore } from '@/core/store';
import type { ReportBranding } from './types';

/** Company identity snapshot for branded documents/exports. */
export function getReportBranding(): ReportBranding {
  const company = useAppStore.getState().activeCompany;
  return {
    companyName: company?.name || '',
    taxNumber: company?.taxNumber,
    address: company?.address,
    phone: company?.phone,
    email: company?.email,
    logoUrl: company?.logoUrl,
    currency: company?.currency || 'YER',
  };
}

/** Reactive branding for report pages (re-renders on company change). */
export function useReportBranding(): ReportBranding {
  const company = useAppStore((state) => state.activeCompany);
  return {
    companyName: company?.name || '',
    taxNumber: company?.taxNumber,
    address: company?.address,
    phone: company?.phone,
    email: company?.email,
    logoUrl: company?.logoUrl,
    currency: company?.currency || 'YER',
  };
}
