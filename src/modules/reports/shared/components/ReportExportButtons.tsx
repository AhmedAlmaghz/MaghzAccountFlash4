import { Download, FileDown, Printer } from 'lucide-react';
import { Button } from '@/core/ui/components';
import { exportReportExcel, exportReportPdf, exportReportHtml, printReportHtml, type ReportSpec } from '@/core/reports';

export interface ReportExportButtonsProps {
  spec: () => ReportSpec | null;
  onError?: (msg: string) => void;
  printEnabled?: boolean;
}

export function ReportExportButtons({ spec, onError, printEnabled = true }: ReportExportButtonsProps) {
  const handle = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => handle(() => exportReportHtml(spec()!))}>
        <Download size={14} /> HTML
      </Button>
      <Button size="sm" variant="outline" onClick={() => handle(() => exportReportExcel(spec()!))}>
        <FileDown size={14} /> Excel
      </Button>
      <Button size="sm" variant="outline" onClick={() => handle(() => exportReportPdf(spec()!))}>
        <Download size={14} /> PDF
      </Button>
      {printEnabled && (
        <Button size="sm" variant="outline" onClick={() => handle(() => printReportHtml(spec()!))}>
          <Printer size={14} />
        </Button>
      )}
    </div>
  );
}
