// One-off fixture cleanup (Phase A-1): remove per-line discount/VAT references
// from test fixtures — sales/api.test.ts + shared-units.test.ts.
const fs = require('fs');

const patterns = [
  // `discountPercent: 0, vatPercent: 0, ` inside line fixtures → nothing
  //   (keys removed; keep other props).
  { re: /discountPercent: 0,\s*vatPercent: 0,\s*/g, out: '' },
  // Standalone `discountPercent: 0` / `vatPercent: 0` in fixtures.
  { re: /\bvatPercent: 0, /g, out: '' },
  { re: /\bvatPercent: 0[,\s]*$/gm, out: '' },
  { re: /\bdiscountPercent: 0, /g, out: '' },
  { re: /\bdiscountPercent: 0[,\s]*$/gm, out: '' },
];

const files = [
  'src/modules/sales/api.test.ts',
  'src/modules/ai/tools/writeTools/shared-units.test.ts',
];
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8');
  for (const { re, out } of patterns) s = s.replace(re, out);
  // Tidy leftovers like ", ," or trailing "lineTotal: 200," in the right place.
  s = s.replace(/lineTotal: (\d+),\s*\)/g, 'lineTotal: $1)');
  fs.writeFileSync(f, s);
  console.log('cleaned', f);
}
