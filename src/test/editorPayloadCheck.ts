import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared checker: does every document editor's create payload satisfy the
 * schema its API validates it with?
 *
 * The API validates a create payload EXACTLY as it arrives — it never
 * injects the tenant and never generates a document number. Every
 * create*Schema therefore requires `companyId` plus the document number.
 *
 * The full-page editors (phase 104) dropped both, so EVERY save failed
 * validation silently: no request was made, and the error named a field the
 * user never touched.
 *
 * Used by src/test/editorPayloadParity.test.ts (the CI gate) and by
 * scripts/check-editor-payloads.mjs (the CLI view of the same check).
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const validation = fs.readFileSync(path.join(ROOT, 'src/core/utils/validation.ts'), 'utf8');

/** Required (non-optional, non-defaulted) top-level fields of a schema. */
export function requiredFields(schemaName: string): string[] | null {
  const i = validation.indexOf(`export const ${schemaName} = z.object({`);
  if (i < 0) return null;
  // start AFTER `z.object({` — the call's paren and the object's brace would
  // otherwise put the fields at depth 2 instead of 0
  const open = validation.indexOf('{', i) + 1;
  const close = validation.indexOf('});', i);
  const body = validation.slice(open, close);

  const fields: string[] = [];
  let depth = 0;
  let pending = '';
  let inStr: string | null = null;
  for (const c of body) {
    if (inStr) {
      if (c === '\\') continue;
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '{' || c === '[' || c === '(') { depth++; pending = ''; continue; }
    if (c === '}' || c === ']' || c === ')') { depth--; pending = ''; continue; }
    if (depth !== 0) { pending = ''; continue; }
    if (c === ':') {
      const m = pending.match(/([a-zA-Z0-9_]+)\s*$/);
      if (m) {
        // the rule of this field runs until the next comma at depth 0
        const rest = body.slice(body.indexOf(m[0], body.indexOf(m[1])) + m[0].length);
        let d = 0;
        let rule = '';
        for (const r of rest) {
          if (r === '{' || r === '[' || r === '(') d++;
          else if (r === '}' || r === ']' || r === ')') d--;
          else if (r === ',' && d === 0) break;
          rule += r;
        }
        if (!/\.optional\(\)/.test(rule) && !/\.default\(/.test(rule)) fields.push(m[1]);
      }
      pending = '';
      continue;
    }
    if (c === ',') { pending = ''; continue; }
    pending += c;
  }
  return fields;
}

/** The top-level keys of every object literal in a payload expression. */
export function payloadKeys(src: string): Set<string> {
  const keys = new Set<string>();
  const m = src.match(/const \w*[Pp]ayload\w* = ([\s\S]*?);\n/);
  if (!m) return keys;
  const expr = m[1];

  const blocks: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let start = -1;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; continue; }
    if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) { blocks.push(expr.slice(start, i + 1)); start = -1; }
      continue;
    }
  }

  for (const block of blocks) {
    let d = 0;
    let pending = '';
    let quote: string | null = null;
    for (let i = 0; i < block.length; i++) {
      const c = block[i];
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; pending = ''; continue; }
      if (c === '{' || c === '[' || c === '(') { d++; pending = ''; continue; }
      if (c === '}' || c === ']' || c === ')') { d--; pending = ''; continue; }
      if (d !== 1) { if (d === 0) pending = ''; continue; }
      if (c === ':') {
        const km = pending.match(/([a-zA-Z0-9_]+)\s*$/);
        if (km) keys.add(km[1]);
        pending = '';
        continue;
      }
      if (c === ',') { pending = ''; continue; }
      pending += c;
    }
    for (const km of block.matchAll(/^\s*([a-zA-Z0-9_]+)\s*,/gm)) keys.add(km[1]);

    // a spread carries the fields of another literal: `...shared`
    for (const sp of block.matchAll(/\.\.\.([a-zA-Z0-9_]+)/g)) {
      const shared = src.match(new RegExp(`const ${sp[1]} = \\{([\\s\\S]*?)\\n {2,6}\\};`));
      if (!shared) continue;
      for (const km of shared[1].matchAll(/^\s*([a-zA-Z0-9_]+)\s*[,:]/gm)) keys.add(km[1]);
    }
  }
  return keys;
}

/** namespace.method → the schema that API method validates with */
export const API_SCHEMA: Record<string, string> = {
  'salesApi.createInvoice': 'createInvoiceSchema',
  'salesApi.createQuotation': 'createQuotationSchema',
  'salesApi.createReturn': 'createSalesReturnSchema',
  'salesApi.createCustomer': 'createCustomerSchema',
  'purchasesApi.createInvoice': 'createPurchaseInvoiceSchema',
  'purchasesApi.createOrder': 'createPurchaseOrderSchema',
  'purchasesApi.createReturn': 'createPurchaseReturnSchema',
  'purchasesApi.createSupplier': 'createSupplierSchema',
  'accountingApi.createTransaction': 'createTransactionSchema',
  'accountingApi.createReceiptVoucher': 'createReceiptVoucherSchema',
  'accountingApi.createPaymentVoucher': 'createPaymentVoucherSchema',
  'inventoryApi.createProduct': 'createProductSchema',
  'manufacturingApi.createBom': 'createBomSchema',
  'manufacturingApi.createWorkOrder': 'createWorkOrderSchema',
};

function editorFiles(): string[] {
  const out: string[] = [];
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('EditorPage.tsx')) out.push(p);
    }
  })(path.join(ROOT, 'src/modules'));
  return out;
}

/** @returns one message per editor whose payload misses a required field */
export function findEditorPayloadProblems(): string[] {
  const problems: string[] = [];
  for (const file of editorFiles()) {
    const rel = path.relative(ROOT, file);
    const src = fs.readFileSync(file, 'utf8');
    const calls = [...src.matchAll(/([a-zA-Z]+Api)\.(create\w+)\(/g)];
    for (const [, ns, method] of calls) {
      const schemaName = API_SCHEMA[`${ns}.${method}`];
      if (!schemaName) continue;
      const req = requiredFields(schemaName);
      if (!req) continue;
      const keys = payloadKeys(src);
      if (!keys.size) { problems.push(`${rel}: no payload literal found`); continue; }
      const missing = req.filter((r) => !keys.has(r));
      if (missing.length) {
        problems.push(`${rel} (${ns}.${method}) is missing: ${missing.join(', ')}`);
      }
    }
  }
  return problems;
}
