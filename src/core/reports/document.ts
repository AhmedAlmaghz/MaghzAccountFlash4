import { escapeHtml } from '../utils/html';
import { formatHumanNumber } from './formatters';
import type { ReportAlign, ReportColumnDef, ReportSpec } from './types';

/**
 * Branded standalone HTML document builder — one modern, clean layout for
 * every report and printable (company header with logo, meta band, styled
 * table with totals, footer). Bidirectional: `meta.direction` flips the
 * whole document; human numbers render in Arabic-Indic digits.
 */

export const DEFAULT_REPORT_ACCENT = '#0B7A5E';

function alignToCss(align: ReportAlign | undefined, direction: 'rtl' | 'ltr'): string {
  if (align === 'center') return 'center';
  if (align === 'end') return direction === 'rtl' ? 'left' : 'right';
  return direction === 'rtl' ? 'right' : 'left';
}

function isNumericColumn(col: ReportColumnDef): boolean {
  return col.format === 'money' || col.format === 'number' || col.format === 'quantity' || col.format === 'percent';
}

export function buildReportHtml(spec: ReportSpec): string {
  const direction = spec.meta.direction ?? 'rtl';
  const lang = direction === 'rtl' ? 'ar' : 'en';
  const accent = spec.meta.accent ?? DEFAULT_REPORT_ACCENT;
  const branding = spec.branding;
  const generatedAt = new Date().toLocaleString(direction === 'rtl' ? 'ar-YE' : 'en-US');

  const companyLines = branding
    ? [branding.address, [branding.phone, branding.email].filter(Boolean).join(' • ')]
        .filter(Boolean)
        .map((l) => `<div class="company-sub">${escapeHtml(String(l))}</div>`)
        .join('')
    : '';
  const taxLine = branding?.taxNumber
    ? `<div class="company-sub">${escapeHtml(direction === 'rtl' ? `الرقم الضريبي: ${branding.taxNumber}` : `Tax No: ${branding.taxNumber}`)}</div>`
    : '';
  const logo = branding?.logoUrl
    ? `<img class="logo" src="${branding.logoUrl}" alt="logo" />`
    : `<div class="logo-fallback">${escapeHtml((branding?.companyName || '•').slice(0, 2))}</div>`;

  const headCells = spec.columns
    .map((c) => `<th style="text-align:${alignToCss(c.align ?? (isNumericColumn(c) ? 'end' : 'start'), direction)}">${escapeHtml(c.header)}</th>`)
    .join('');

  const bodyRows = spec.rows
    .map((row, i) => {
      const cells = spec.columns
        .map((c) => {
          const raw = row[c.key];
          let text: string;
          if (c.render) {
            text = c.render(raw, row);
          } else if (c.format === 'money' || c.format === 'number' || c.format === 'quantity') {
            text = formatHumanNumber(raw, c.decimals);
          } else if (c.format === 'date' || c.format === 'datetime' || c.format === 'percent' || c.format === 'text' || !c.format) {
            const v = raw === null || raw === undefined ? '' : String(raw);
            text = escapeHtml(v);
          } else {
            text = escapeHtml(raw === null || raw === undefined ? '' : String(raw));
          }
          const numeric = isNumericColumn(c);
          return `<td class="${numeric ? 'num' : ''}" style="text-align:${alignToCss(c.align ?? (numeric ? 'end' : 'start'), direction)}">${text}</td>`;
        })
        .join('');
      return `<tr class="${i % 2 === 1 ? 'zebra' : ''}">${cells}</tr>`;
    })
    .join('');

  const totalsRow = spec.totals
    ? `<tr class="totals">${spec.columns
        .map((c, idx) => {
          if (idx === 0) return `<td>${escapeHtml(spec.totals!.label)}</td>`;
          const v = spec.totals!.values[c.key];
          const text = v === undefined || v === null || v === ''
            ? ''
            : typeof v === 'number' && isNumericColumn(c)
              ? formatHumanNumber(v, c.decimals)
              : escapeHtml(String(v));
          return `<td class="${isNumericColumn(c) ? 'num' : ''}">${text}</td>`;
        })
        .join('')}</tr>`
    : '';

  const emptyRow = spec.rows.length === 0
    ? `<tr><td colspan="${spec.columns.length}" class="empty">${escapeHtml(direction === 'rtl' ? 'لا توجد بيانات' : 'No data')}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html dir="${direction}" lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(spec.meta.title)}</title>
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; color: #1e293b; margin: 0; padding: 32px; background: #fff; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 20px; border-bottom: 3px solid var(--accent); margin-bottom: 20px; }
  .brand { display: flex; gap: 14px; align-items: center; }
  .logo { width: 72px; height: 72px; object-fit: contain; border: 1px solid #e2e8f0; border-radius: 12px; padding: 4px; }
  .logo-fallback { width: 72px; height: 72px; border-radius: 12px; background: var(--accent); color: #fff; font-size: 28px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
  .company-name { font-size: 22px; font-weight: 800; margin: 0; }
  .company-sub { font-size: 12px; color: #64748b; margin-top: 2px; }
  .title-block { text-align: end; }
  .report-title { font-size: 20px; font-weight: 800; margin: 0 0 4px; color: var(--accent); }
  .report-sub { font-size: 12px; color: #64748b; }
  .meta { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: #475569; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; margin-bottom: 18px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { background: var(--accent); color: #fff; padding: 10px 12px; font-weight: 700; white-space: nowrap; }
  thead th:first-child { border-start-start-radius: 10px; }
  thead th:last-child { border-start-end-radius: 10px; }
  tbody td { padding: 9px 12px; border-bottom: 1px solid #e2e8f0; }
  tbody tr.zebra td { background: #f8fafc; }
  tbody td.num { font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: embed; }
  tr.totals td { background: #eef2ff; font-weight: 800; border-top: 2px solid var(--accent); }
  td.empty { text-align: center; color: #94a3b8; padding: 32px; }
  .footer { margin-top: 22px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
  @media print {
    body { padding: 0; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    @page { size: A4; margin: 12mm; @bottom-center { content: counter(page); font-size: 10px; color: #94a3b8; } }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="brand">${logo}<div><h1 class="company-name">${escapeHtml(branding?.companyName || '')}</h1>${companyLines}${taxLine}</div></div>
    <div class="title-block"><p class="report-title">${escapeHtml(spec.meta.title)}</p>${spec.meta.subtitle ? `<div class="report-sub">${escapeHtml(spec.meta.subtitle)}</div>` : ''}</div>
  </div>
  ${spec.meta.periodLabel ? `<div class="meta"><span>${escapeHtml(spec.meta.periodLabel)}</span></div>` : ''}
  <table>
    <thead><tr>${headCells}</tr></thead>
    <tbody>${bodyRows}${emptyRow}</tbody>
    ${totalsRow ? `<tfoot>${totalsRow}</tfoot>` : ''}
  </table>
  <div class="footer"><span>${escapeHtml(direction === 'rtl' ? `أُنشئ بواسطة نظام maghzaccount-pro — ${generatedAt}` : `Generated by maghzaccount-pro — ${generatedAt}`)}</span></div>
  <script>if (window.__autoPrint) { setTimeout(() => window.print(), 400); }</script>
</body>
</html>`;
}
