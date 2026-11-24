import { type ReactNode } from 'react';
import { FileDown, RotateCcw } from 'lucide-react';
import { Button, PageHeader, Card } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import type { ReportSpec } from '@/core/reports';

export interface ReportPageShellProps {
  title: string;
  subtitle?: string;
  exportData?: () => ReportSpec | null;
  children: ReactNode;
  showRefresh?: boolean;
  refresh: () => void;
  isLoading?: boolean;
  isReady?: boolean;
  periodLabel?: string;
}

export function ReportPageShell({
  title, subtitle, exportData, children, showRefresh, refresh, isLoading, isReady, periodLabel,
}: ReportPageShellProps) {
  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader title={title} subtitle={subtitle} />
      <Card className="flex flex-wrap items-center gap-2">
        {showRefresh && <Button size="sm" variant="outline" onClick={refresh} disabled={isLoading}><RotateCcw size={14} />{periodLabel}</Button>}
        <div className="ml-auto flex gap-2">
          {exportData && (
            <>
              <Button size="sm" variant="outline" disabled={!isReady} onClick={() => exportData()}><FileDown size={14} /></Button>
            </>
          )}
        </div>
      </Card>
      {isLoading && <div className="py-8 flex justify-center"><RotateCcw className="animate-spin" /></div>}
      {!isLoading && !isReady && <EmptyState icon="inbox" title={title} description="noData" />}
      {children}
    </div>
  );
}

export default ReportPageShell;
