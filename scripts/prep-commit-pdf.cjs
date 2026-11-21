const { execSync } = require('child_process');
const fs = require('fs');
const cwd = 'E:\\MaghzAccountApp\\MaghzAccountFlash35';
const files = [
  'src/core/reports/pdf/reportPdfExporter.ts',
  'src/core/reports/pdf/reportPdfExporter.test.ts',
  'src/core/reports/exporters.ts',
  'src/core/utils/exportEngine.ts',
  'src/core/utils/export.ts',
  'src/core/utils/export.test.ts',
  'src/core/utils/printDocument.ts',
  'src/core/utils/printDocument.test.ts',
  'electron/dbHandler.js',
  'electron/preload.cjs',
  'electron/preload.js',
];
execSync(`git add ${files.map((f) => `"${f}"`).join(' ')}`, { cwd });
fs.writeFileSync('commit-msg-pdf.txt', [
  'feat(reports): universal PDF engine (Electron printToPDF + web jsPDF)',
  '',
  '- New src/core/reports/pdf/reportPdfExporter.ts — single engine:',
  '  Electron → webContents.printToPDF (no popups, blob download);',
  '  Web/mobile → jsPDF + autoTable + Arabic pipeline (IBM Plex Sans Arabic).',
  '- Refactored: exporters.ts (web path → engine), export.ts, exportEngine.ts, printDocument.ts',
  '- Electron: db:print-to-pdf channel (dbHandler + preload.cjs/js)',
  '- i18n: none added (reuses existing report keys)',
  '- Verification: tsc 0, vitest 12 files / 195 tests (accounting+reports+core/reports+exportEngine callers), build running',
].join('\n'));
const status = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
console.log(status.split('\n').filter((l) => /^A  |^M /.test(l)).map((l) => l.slice(0, 50)).join('\n'));
