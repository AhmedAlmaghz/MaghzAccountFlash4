import fs from 'fs';
import path from 'path';

const root = 'e:/MaghzAccountApp/MaghzAccountFlash35';
const BT = String.fromCharCode(96);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function blockLen(src, label) {
  const i = src.indexOf('const ' + label);
  if (i < 0) return -1;
  const b = src.indexOf(BT, i);
  // block ends with backtick followed by newline then .trim()
  const e = src.indexOf(BT + '\n', b + 1);
  if (b < 0 || e < 0) return -1;
  return Array.from(src.slice(b + 1, e)).length;
}

const sp = read('src/modules/ai/engine/systemPrompt.ts');
const baseNames = ['TERMINOLOGY_GLOSSARY', 'ACCOUNTING_MODEL', 'RESPONSE_STYLE', 'TOOL_USAGE_GUIDE', 'SITUATION_TIPS', 'RULES'];
let baseSum = 0;
for (const n of baseNames) {
  const len = blockLen(sp, n);
  console.log(n, len);
  baseSum += Math.max(0, len);
}
console.log('BASE_SUM', baseSum);

// skills: content ends with "\n  `," (2-space indent + backtick + comma)
const skillDir = path.join(root, 'src/modules/ai/skills');
const files = fs.readdirSync(skillDir).filter((f) => f.endsWith('.ts') && !/test|index|registry|types/.test(f));
let alwaysSum = 0;
for (const f of files) {
  const s = fs.readFileSync(path.join(skillDir, f), 'utf8');
  const mode = (s.match(/loadingMode:\s*'([^']+)'/) || [])[1] || '?';
  const ci = s.indexOf('content:');
  const b = s.indexOf(BT, ci);
  const e = s.indexOf('\n  ' + BT + ',', b + 1);
  const len = b >= 0 && e >= 0 ? Array.from(s.slice(b + 1, e)).length : -1;
  console.log(f, 'mode=' + mode, 'contentChars=' + len);
  if (mode === 'always') alwaysSum += Math.max(0, len);
}
console.log('ALWAYS_ON_SUM', alwaysSum);
console.log('BASE_PLUS_ALWAYS', baseSum + alwaysSum);
console.log('ELECTRON_PER_MESSAGE_CAP', 20000);
