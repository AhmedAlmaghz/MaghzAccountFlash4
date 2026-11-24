import fs from 'fs';

const pages = [
  ['TrialBalancePage', 'TrialBalancePage'],
  ['PayrollReportPage', 'PayrollReportPage'],
  ['AttendanceReportPage', 'AttendanceReportPage'],
  ['EndOfServiceReportPage', 'EndOfServiceReportPage'],
  ['RepPerformancePage', 'RepPerformancePage'],
  ['SalesCommissionReportPage', 'SalesCommissionReportPage'],
  ['InventoryItemLedgerPage', 'InventoryItemLedgerPage'],
  ['StockDiffReportPage', 'StockDiffReportPage'],
  ['ManufacturingVariancePage', 'ManufacturingVariancePage'],
  ['ProductionCostReportPage', 'ProductionCostReportPage'],
  ['DocInvoiceDetailsPage', 'DocInvoiceDetailsPage'],
  ['FixedAssetsDepreciationReportPage', 'FixedAssetsDepreciationReportPage'],
];

for (const [file, comp] of pages) {
  const p = `src/modules/reports/${file}.tsx`;
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes(`export default ${comp};`)) {
    s = s.trimEnd() + `\n\nexport default ${comp};\n`;
    fs.writeFileSync(p, s);
    console.log('added default export:', comp);
  }
}
