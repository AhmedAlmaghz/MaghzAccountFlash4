/**
 * SHARED analysis of the e2e bridge shim (e2e/vite-e2e-plugin.ts).
 *
 * One source of truth for three consumers:
 *  - `scripts/check-shim-parse.cjs`  → the plain-node CLI;
 *  - `scripts/check-shim-params.cjs` → the plain-node CLI;
 *  - `src/test/e2eShimParity.test.ts` → the CI gate.
 *
 * Why shared: the CLI and the vitest gate once carried DIFFERENT logic for
 * the same defect class, so each caught what the other missed. The lesson is
 * the same as for the encoding gate — two implementations of one rule means
 * neither rule is really enforced.
 *
 * The shim is one enormous template literal. Two failure modes are checked
 * here, both of which produce a "database connection failed" screen with no
 * hint about the cause:
 *
 *  1. the generated code does not PARSE (a SQL literal lost its escaping
 *     backslash) — then `window.electronDB` is never defined;
 *  2. a query passes a different number of parameters than it has
 *     placeholders — PostgreSQL rejects the statement and the write fails.
 */
import vm from 'node:vm';

/** Extract the generated shim code from the plugin source. */
export function extractShimCode(source) {
  const start = source.indexOf('const shimCode = `');
  if (start < 0) throw new Error('shimCode template not found');
  const from = start + 'const shimCode = `'.length;
  for (let i = from; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === '`') {
      const raw = source.slice(from, i);
      // Evaluating the TEMPLATE yields the shim as a STRING — the shim code
      // itself is never executed, so no side effect can escape.
      return new Function('return `' + raw + '`')();
    }
  }
  throw new Error('closing backtick not found — the shim is truncated');
}

/**
 * Parse the generated shim.
 * @returns {{ ok: true } | { ok: false, error: string, line?: number, context?: string[] }}
 */
export function parseShimCode(code) {
  try {
    new vm.Script(code, { filename: 'shim.js' });
    return { ok: true };
  } catch (err) {
    const stack = String(err.stack || '');
    const m = /shim\.js:(\d+)/.exec(stack);
    const result = { ok: false, error: String(err.message || err).slice(0, 400) };
    if (m) {
      const line = Number(m[1]);
      const lines = code.split('\n');
      result.line = line;
      result.context = lines.slice(Math.max(0, line - 3), line + 1).map((l) => l.slice(0, 200));
    }
    return result;
  }
}

/** Split the argument list of a call whose '(' is at `open`. */
function splitArgs(text, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  let inStr = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { args.push(text.slice(start, i)); return args; }
    } else if (c === ',' && depth === 1) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return args;
}

/** Does the expression contain a top-level `+` (i.e. it is concatenated)? */
function isConcatenated(expr) {
  let depth = 0;
  let inStr = null;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === '+' && depth === 0) return true;
  }
  return false;
}

/** Count the elements of a literal array expression (null when not literal). */
export function countArrayElements(expr) {
  const trimmed = expr.trim();
  if (!trimmed.startsWith('[')) return null;
  if (trimmed === '[]') return 0;
  let depth = 0;
  let count = 0;
  let inStr = null;
  let sawContent = false;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; sawContent = true; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; if (depth > 1) sawContent = true; continue; }
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { if (sawContent) count++; break; }
      continue;
    }
    if (depth === 1 && c === ',') { count++; sawContent = false; continue; }
    if (depth === 1 && !/\s/.test(c)) sawContent = true;
  }
  return count;
}

/**
 * Compare the $N placeholders with the parameter count for every STATIC
 * `post(sql, [params])` in the shim.
 *
 * Dynamic statements (SQL built by concatenation, params built in a loop)
 * are decided at runtime and are skipped on purpose.
 *
 * @returns {{ checked: number, skipped: number, problems: Array<{method:string, placeholders:number, params:number, sql:string}> }}
 */
export function checkStaticParamCounts(body) {
  const problems = [];
  let checked = 0;
  let skipped = 0;

  const re = /post\(/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const open = m.index + m[0].length - 1;
    const args = splitArgs(body, open);
    if (args.length < 2) { skipped++; continue; }

    const sqlExpr = args[0].trim();
    const paramsExpr = args[1].trim();
    if (isConcatenated(sqlExpr) || isConcatenated(paramsExpr)) { skipped++; continue; }

    const sql = sqlExpr.replace(/^["'`]|["'`]$/g, '');
    const paramCount = countArrayElements(paramsExpr);
    if (paramCount === null) { skipped++; continue; }

    const placeholders = new Set((sql.match(/\$(\d+)/g) || []).map((x) => Number(x.slice(1))));
    const maxPh = placeholders.size ? Math.max(...placeholders) : 0;
    checked++;

    if (paramCount !== maxPh) {
      const before = body.slice(Math.max(0, m.index - 600), m.index);
      const names = [...before.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(?:async\s+)?(?:function\s*)?\(/g)];
      problems.push({
        method: names.length ? names[names.length - 1][1] : '?',
        placeholders: maxPh,
        params: paramCount,
        sql: sql.replace(/\s+/g, ' ').slice(0, 110),
      });
    }
  }

  return { checked, skipped, problems };
}
