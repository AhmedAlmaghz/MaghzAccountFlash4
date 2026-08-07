import { escapeHtml, sanitizeElementHtml } from '@/core/utils/html';

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

export function exportToPdf(elementId: string, filename: string, title?: string) {
  const element = document.getElementById(elementId);
  if (!element) {
    alert('عنصر التصدير غير موجود');
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('يرجى السماح بفتح النوافذ المنبثقة للتصدير');
    return;
  }

  const htmlContent = `
  <!DOCTYPE html>
  <html dir="rtl">
  <head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title || filename)}</title>
  <style>
  @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap');
  * { box-sizing: border-box; }
  body {
    font-family: 'Cairo', sans-serif;
    margin: 20px;
    color: #1e293b;
    background: white;
  }
  h1 { text-align: center; margin-bottom: 8px; font-size: 18px; }
  .meta { text-align: center; color: #64748b; font-size: 12px; margin-bottom: 20px; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  th, td {
    border: 1px solid #cbd5e1;
    padding: 8px 12px;
    text-align: right;
  }
  th {
    background: #1e40af;
    color: white;
    font-weight: 600;
  }
  tr:nth-child(even) { background: #f8fafc; }
  .number { text-align: left; direction: ltr; }
  .total-row { background: #dbeafe !important; font-weight: bold; }
  @media print {
    body { margin: 10px; }
    .no-print { display: none; }
  }
  </style>
  </head>
  <body>
  <h1>${escapeHtml(title || filename)}</h1>
  <div class="meta">تاريخ التقرير: ${escapeHtml(new Date().toLocaleDateString('ar-SA'))}</div>
  ${sanitizeElementHtml(element)}
  <div class="no-print" style="margin-top: 30px; text-align: center;">
  <button onclick="window.print()" style="padding: 10px 30px; background: #1e40af; color: white; border: none; border-radius: 6px; cursor: pointer; font-family: Cairo;">
  طباعة / حفظ PDF
  </button>
  </div>
  </body>
  </html>
  `;

  printWindow.document.write(htmlContent);
  printWindow.document.close();
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
