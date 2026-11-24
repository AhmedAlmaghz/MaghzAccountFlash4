import fs from 'fs';

const files = ['AttendanceReportPage','DocInvoiceDetailsPage','EndOfServiceReportPage','FixedAssetsDepreciationReportPage','InventoryItemLedgerPage','ManufacturingVariancePage','RepPerformancePage','StockDiffReportPage','TrialBalancePage','PayrollReportPage'];

for (const f of files) {
  const p = `src/modules/reports/${f}.tsx`;
  let s = fs.readFileSync(p, 'utf8');
  // Ensure Button present where used.
  if (s.includes('<Button')) {
    if (!/Button,/.test(s.split('\n').find((l) => l.includes('@/core/ui/components')))) {
      s = s.replace(/(import {[^}]*)(PageHeader, Card)/, '$1$2, Button');
    }
    if (!/Button[,}\s]/.test(s.split('from \'@/core/ui/components\'')[0])) {
      // add Button to the core/ui/components import
      s = s.replace(/import { PageHeader, Card(, Button)?, Select, Input } from '@\/core\/ui\/components';/, (m) => m);
    }
    if (!/^import {[^}]*\bButton\b[^}]*} from '@\/core\/ui\/components';/m.test(s)) {
      s = s.replace(/import { PageHeader, Card, (?!Button)([^}]*) } from '@\/core\/ui\/components';/, 'import { PageHeader, Card, Button, $1 } from \'@/core/ui/components\';');
    }
  }
  // Strip known unused imports listed per file
  const unusedByFile = {
    AttendanceReportPage: ["type RowWithBase"],
    DocInvoiceDetailsPage: ['Coins'],
    FixedAssetsDepreciationReportPage: ['Money', 'percentOf, deltaWithPct'],
    InventoryItemLedgerPage: ['Warehouse', 'deltaWithPct', 'formatCurrency'],
    ManufacturingVariancePage: ['AlertTriangle'],
  };
  for (const u of unusedByFile[f] || []) {
    s = s.split(u).join('');
  }
  // Fix RowWithBase casts
  s = s.split(' as RowWithBase[]').join('');
  fs.writeFileSync(p, s);
}
console.log('imports fixed');
