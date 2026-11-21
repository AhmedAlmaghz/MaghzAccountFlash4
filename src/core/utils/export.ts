import { escapeHtml } from '@/core/utils/html';
import { exportToPdfFromHtml, type UniversalExportResult } from '@/core/reports/pdf/reportPdfExporter';

export async function exportToExcel(data: Record<string, unknown>[], filename: string, sheetName: string = 'Sheet1') {
  if (!data || data.length === 0) {
    alert('لا توجد بيانات للتصدير');
    return;
  }

  const { utils, writeFile } = await import('xlsx');
  const ws = utils.json_to_sheet(data);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, sheetName);
  writeFile(wb, `${filename}.xlsx`);
}

export async function exportToPdf(
  elementId: string,
  filename: string,
  title?: string,
): Promise<UniversalExportResult> {
  const element = document.getElementById(elementId);
  if (!element) {
    alert('عنصر التصدير غير موجود');
    return { success: false, error: 'element-not-found' };
  }
  // Universal engine: Electron → printToPDF → blob download; Web/mobile → jsPDF.
  return exportToPdfFromHtml(element.outerHTML, { filename, title: title || filename });
}

export function dataToHtmlTable(data: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  if (!data || data.length === 0) return '<p>لا توجد بيانات</p>';

  let html = '<table>';
  html += '<thead><tr>';
  for (const col of columns) {
    html += `<th>${escapeHtml(col.label)}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const row of data) {
    html += '<tr>';
    for (const col of columns) {
      const val = row[col.key];
      const display = val === null || val === undefined ? '-' :
        typeof val === 'number' ? `<span class="number">${new Intl.NumberFormat('ar-YE').format(val)}</span>` :
        escapeHtml(String(val));
      html += `<td>${display}</td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  return html;
}
