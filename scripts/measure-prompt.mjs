import fs from 'fs';
import path from 'path';

const root = 'e:/MaghzAccountApp/MaghzAccountFlash35';
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function extractConsts(src, names) {
  const out = {};
  for (const n of names) {
    const startMarker = 'const ' + n + ' = `';
    const i = src.indexOf(startMarker);
    if (i < 0) { out[n] = -1; continue; }
    const from = i + startMarker.length;
    // template ends with "`\n.trim()" — find the first backtick followed by newline+.trim()
    let end = -1;
    let idx = from;
    while (true) {
      const b = src.indexOf('`', idx);
      if (b < 0) break;
      const after = src.slice(b, b + 12);
      if (after.startsWith('`\n') || after.startsWith('`\r')) { end = b; break; }
      idx = b + 1;
    }
    out[n] = end < 0 ? -1 : Array.from(src.slice(from, end)).length;
  }
  return out;
}

const sp = read('src/modules/ai/engine/systemPrompt.ts');
const base = extractConsts(sp, ['TERMINOLOGY_GLOSSARY', 'ACCOUNTING_MODEL', 'RESPONSE_STYLE', 'TOOL_USAGE_GUIDE', 'SITUATION_TIPS', 'RULES']);
console.log('--- base prompt blocks (chars) ---');
let baseSum = 0;
for (const [k, v] of Object.entries(base)) { console.log(k, v); baseSum += Math.max(0, v); }
console.log('BASE_SUM', baseSum);

console.log('--- skills ---');
const skillFiles = fs.readdirSync(path.join(root, 'src/modules/ai/skills')).filter((f) => f.endsWith('.ts') && !f.includes('test') && !['index.ts', 'registry.ts', 'types.ts'].includes(f));
let alwaysSum = 0;
for (const f of skillFiles) {
  const s = read('src/modules/ai/skills/' + f);
  const mode = (s.match(/loadingMode:\s*'([^']+)'/) || [])[1] || '?';
  const ci = s.indexOf('content: `');
  let clen = -1;
  if (ci >= 0) {
    const from = ci + 'content: `'.length;
    // content template ends before "\n`," or "\n`;" — find backtick at line start
    const m = s.slice(from).match(/\n`,/);
    clen = m ? Array.from(s.slice(from, from + m.index)).length : -1;
  }
  console.log(f, 'mode=' + mode, 'contentChars=' + clen);
  if (mode === 'always') alwaysSum += Math.max(0, clen);
}
console.log('ALWAYS_ON_SUM', alwaysSum);

// tool inventory estimate: count registered tool names
const toolSrc = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts') && !e.name.includes('test')) toolSrc.push(p);
  }
}
walk(path.join(root, 'src/modules/ai/tools'));
let names = new Set();
for (const f of toolSrc) {
  const s = fs.readFileSync(f, 'utf8');
  const re = /name:\s*'([a-z0-9_.]+)'/g;
  let m;
  while ((m = re.exec(s))) { if (m[1].includes('.')) names.add(m[1]); }
}
let invLen = 0;
const groups = new Map();
for (const n of names) {
  const d = n.split('.')[0];
  if (!groups.has(d)) groups.set(d, []);
  groups.get(d).push(n);
}
for (const [d, ns] of groups) invLen += ('- ' + d + ': ').length + ns.join('، ').length + 1;
console.log('TOOL_NAMES', names.size, 'INVENTORY_CHARS~', invLen);
console.log('ESTIMATED_SYSTEM_PROMPT', baseSum + alwaysSum + invLen + 1200, '(+1200 company/context/skills headers)');
console.log('ELECTRON_CAP_PER_MESSAGE', 20000);
