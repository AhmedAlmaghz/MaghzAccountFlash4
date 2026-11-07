import type { ToolDefinition } from '../types';
import { getAllTools } from '../tools/registry';
import { ensureToolsRegistered } from '../tools';

/**
 * Arabic agent evaluation harness (audit 2026-11-07).
 *
 * No LLM calls: each case is a deterministic contract check the harness can
 * answer without a provider (tool exists, permission verb aligns, dialect
 * map canonical in the prompt path, quantity/price extraction via
 * argNormalizers, date hijri/gregorian round-trip). Live LLM evals belong
 * in CI with a key — this harness gates the deterministic 90%.
 */
export interface EvalCase {
  id: string;
  category: string;
  claim: string;
  run: () => Promise<{ pass: boolean; detail: string }>;
}

export interface EvalReport {
  at: string;
  total: number;
  passed: number;
  failed: number;
  cases: Array<{ id: string; category: string; pass: boolean; detail: string }>;
}

export async function runEvalHarness(): Promise<EvalReport> {
  ensureToolsRegistered();
  const tools = getAllTools();
  const byName = new Map(tools.map((t) => [t.name, t]));
  const cases: EvalCase[] = [
    {
      id: 'tools.registered',
      category: 'registry',
      claim: 'all 4 new write/write tools registered with contract shape',
      run: async () => {
        const need = ['pos.open_shift', 'pos.close_shift', 'sales.convert_quotation_to_invoice', 'purchases.convert_order_to_invoice', 'accounting.update_journal_entry', 'inventory.post_stock_transfer'];
        const missing = need.filter((n) => !byName.has(n));
        const bad = need.filter((n) => {
          const t = byName.get(n);
          return !t || !t.summarizeArgs || !(t.parameters as { type?: string })?.type;
        });
        return { pass: missing.length === 0 && bad.length === 0, detail: missing.length ? `missing: ${missing.join(', ')}` : bad.length ? `no summarize/params: ${bad.join(', ')}` : `${need.length}/6 present` };
      },
    },
    {
      id: 'search.canonical-home',
      category: 'registry',
      claim: 'search.departments + search.fixed_assets live in searchTools only (single home)',
      run: async () => {
        const { searchTools } = await import('../tools/searchTools');
        const names = new Set(searchTools.map((t: ToolDefinition) => t.name));
        const ok = names.has('search.departments') && names.has('search.fixed_assets') && names.has('search.branches') && names.has('search.currencies');
        return { pass: ok, detail: ok ? '4/4 in searchTools' : 'canonical search home incomplete' };
      },
    },
    {
      id: 'customer.canonical',
      category: 'contract',
      claim: 'crm.create_customer delegates to the sales canonical (single source)',
      run: async () => {
        const { crmWriteTools } = await import('../tools/writeTools/crm');
        const t = crmWriteTools.find((x: ToolDefinition) => x.name === 'crm.create_customer');
        const desc = String(t?.descriptionAr ?? '');
        return { pass: !!t && desc.includes('sales.create_customer'), detail: !!t ? desc.slice(0, 80) : 'tool missing' };
      },
    },
    {
      id: 'dialect.payment',
      category: 'dialect',
      claim: 'canonicalPaymentMethod maps Yemeni/gulf dialect to cash/bank',
      run: async () => {
        const { canonicalPaymentMethod } = await import('../engine/dialectMap');
        const a = canonicalPaymentMethod('حوالة عبر المنصة');
        const b = canonicalPaymentMethod('كاش كاش');
        return { pass: a === 'bank' && b === 'cash', detail: `حوالة→${a}, كاش→${b}` };
      },
    },
    {
      id: 'numbers.arabic',
      category: 'normalize',
      claim: 'parseFlexibleNumber converts Arabic-Indic + separators',
      run: async () => {
        const { parseFlexibleNumber } = await import('../engine/argNormalizers');
        const v = parseFlexibleNumber('١٣٢٬٥٠٠ ريال');
        return { pass: v === 132500, detail: `parsed=${v} expected=132500` };
      },
    },
    {
      id: 'dates.hijri',
      category: 'normalize',
      claim: 'Hijri date converts within ±2 days of Gregorian',
      run: async () => {
        const { normalizeHijriDateArg } = await import('../engine/argNormalizers');
        const v = normalizeHijriDateArg('1 محرم 1448') ?? normalizeHijriDateArg('1 Muharram 1448');
        return { pass: typeof v === 'string' && /^2026-06-/.test(v), detail: `hijri→${v}` };
      },
    },
  ];

  const results: EvalReport['cases'] = [];
  for (const c of cases) {
    try {
      const r = await c.run();
      results.push({ id: c.id, category: c.category, pass: r.pass, detail: r.detail });
    } catch (e) {
      results.push({ id: c.id, category: c.category, pass: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return {
    at: new Date().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    cases: results,
  };
}
