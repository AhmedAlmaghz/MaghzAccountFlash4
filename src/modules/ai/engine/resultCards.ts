import { useAppStore } from '@/core/store';
import { untrustedDataBlock } from './llmParts';

/**
 * Result-card rendering (pure display logic) — extracted verbatim from
 * chatEngine.ts (D-phase decomposition). Renders tool outcomes as Arabic
 * markdown tables/cards for approval UIs and compacts them for LLM context
 * (NOISY_FIELDS stripped, untrusted-data fenced, size-capped).
 */

/**
 * Render an array of simple objects as a pipe-delimited markdown table.
 */
function renderTable(rows: Record<string, unknown>[], label?: string): string {
  if (rows.length === 0) return label ? `${label}: (فارغ)` : '(فارغ)';

  // Pick keys from the first row, filtering out long/internal ones
  const keys = Object.keys(rows[0]).filter(
    (k) => k !== 'id' && !k.startsWith('_') && String(rows[0][k] ?? '').length < 60,
  );
  if (keys.length === 0) return label ? `${label}: ${rows.length} عنصر` : `${rows.length} عنصر`;

  // Build header
  const arabicHeaders: Record<string, string> = {
    name: 'الاسم',
    name_ar: 'الاسم',
    customerName: 'العميل',
    customer_name: 'العميل',
    supplierName: 'المورد',
    supplier_name: 'المورد',
    productName: 'المنتج',
    product_name: 'المنتج',
    code: 'الكود',
    phone: 'الهاتف',
    balance: 'الرصيد',
    total: 'الإجمالي',
    totalAmount: 'المبلغ',
    total_amount: 'المبلغ',
    amount: 'المبلغ',
    paidAmount: 'المدفوع',
    paid_amount: 'المدفوع',
    status: 'الحالة',
    date: 'التاريخ',
    invoiceNumber: 'رقم الفاتورة',
    invoice_number: 'رقم الفاتورة',
    quantity: 'الكمية',
    unitPrice: 'سعر الوحدة',
    unit_price: 'سعر الوحدة',
    email: 'البريد',
    createdAt: 'تاريخ الإنشاء',
    created_at: 'تاريخ الإنشاء',
  };

  const headers = keys.map((k) => arabicHeaders[k] ?? k);
  const headerLine = `| ${headers.join(' | ')} |`;
  const sepLine = `| ${keys.map(() => '---').join(' | ')} |`;

  const bodyLines = rows.map((row) => {
    const vals = keys.map((k) => {
      const v = row[k];
      if (v === null || v === undefined) return '';
      // P2 fix (mirrors renderObject): nested objects/arrays must NEVER hit
      // String() — yields the infamous "[object Object]" in card tables.
      const s = typeof v === 'object' ? safeJson(v) : String(v);
      return s.length > 50 ? s.slice(0, 47) + '...' : s;
    });
    return `| ${vals.join(' | ')} |`;
  });

  const title = label ? `**${label}**\n\n` : '';
  return `${title}${headerLine}\n${sepLine}\n${bodyLines.join('\n')}`;
}

/**
 * Render an object as key-value lines with icons.
 */
function renderObject(obj: Record<string, unknown>, title?: string): string {
  const lines: string[] = [];
  if (title) lines.push(`**${title}**\n`);

  const iconMap: Record<string, string> = {
    name: '👤',
    customerName: '👤',
    customer_name: '👤',
    supplierName: '🏢',
    supplier_name: '🏢',
    phone: '📞',
    email: '📧',
    totalAmount: '💰',
    total_amount: '💰',
    amount: '💰',
    paidAmount: '✅',
    paid_amount: '✅',
    balance: '💰',
    status: '📌',
    date: '📅',
    invoiceNumber: '📄',
    invoice_number: '📄',
    notes: '📝',
  };

  for (const [k, v] of Object.entries(obj)) {
    if (k === 'id' || k.startsWith('_')) continue;
    const icon = iconMap[k] ?? '•';
    const label = k.replace(/_/g, ' ');
    if (v !== null && v !== undefined) {
      // Nested objects/arrays must NEVER hit String() (yields the infamous
      // "[object Object]") — render compact JSON instead.
      const text = typeof v === 'object' ? safeJson(v) : String(v);
      lines.push(`${icon} ${label}: ${text}`);
    }
  }

  return lines.join('\n');
}

/** Compact JSON for nested values inside cards — never String(obj). */
function safeJson(v: unknown): string {
  try {
    const json = JSON.stringify(v);
    return json.length <= 300 ? json : `${json.slice(0, 300)}…`;
  } catch {
    return '؟';
  }
}

/**
 * Format a numeric value with commas and a currency symbol suffix.
 * Uses the ACTIVE company's currency — the old hardcoded ' ر.ي' mislabeled
 * every amount for companies operating in USD/SAR/AED (the system prompt
 * itself says the currency may be anything).
 */
function fmtCurrency(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!isFinite(n) || isNaN(n)) return String(v ?? '');
  const currency = useAppStore.getState().activeCompany?.currency || 'YER';
  const symbol = CURRENCY_LABELS[currency] ?? currency;
  return n.toLocaleString('ar-YE') + ` ${symbol}`;
}

/** Compact label per currency code (falls back to the raw code). */
const CURRENCY_LABELS: Record<string, string> = {
  YER: 'ر.ي', SAR: 'ر.س', USD: '$', AED: 'د.إ', EGP: 'ج.م', KWD: 'د.ك',
  QAR: 'ر.ق', OMR: 'ر.ع', BHD: 'د.ب', JOD: 'د.أ', IQD: 'د.ع',
  EUR: '€', GBP: '£', TRY: '₺',
};

/**
 * Convert a raw tool result into a beautifully formatted, human-readable string
 * that may contain markdown-like tables (pipe-delimited) and key-value cards.
 *
 * The formatted text is shown to the user in the ToolCallCard and is also used
 * as context for the LLM in subsequent turns.
 */
/**
 * Compact a raw tool result before feeding it back into the LLM context.
 *
 * Full JSON dumps of search/report results bloat the context window every
 * iteration (slower responses, higher token cost, and eventually provider
 * rejections). Best practice (OpenAI/Anthropic agent guidance): keep tool
 * payloads small — strip noisy internal fields and cap the serialized size,
 * marking the truncation explicitly so the model knows data was elided.
 */
const TOOL_RESULT_MAX_CHARS = 4000;
const NOISY_FIELDS = new Set([
  'companyId', 'company_id', 'createdBy', 'created_by', 'updatedBy', 'updated_by',
  'createdAt', 'created_at', 'updatedAt', 'updated_at', 'openingBalancePosted',
  'opening_balance_posted', 'isActive', 'is_active', 'passwordHash',
]);
// NOTE: `notes` is deliberately NOT stripped — in search results it can carry
// the business WHY (rejection reason, reference, memo). Only truly internal
// audit/tenant plumbing is noise for the model.

export function compactToolResultForLlm(result: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(result, (key, value) => (NOISY_FIELDS.has(key) ? undefined : value));
  } catch {
    return '✅ تم بنجاح';
  }
  // Every DB-sourced payload rides inside the untrusted-data fence (P1-2):
  // notes/customer names inside the JSON are DATA, never instructions.
  if (json.length <= TOOL_RESULT_MAX_CHARS) return untrustedDataBlock('نتيجة أداة', json);

  // Try trimming array payloads first (search/list tools) so the model keeps
  // whole items rather than a cut-off JSON fragment.
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    for (const key of ['matches', 'items', 'data']) {
      const arr = obj[key];
      if (Array.isArray(arr) && arr.length > 3) {
        const trimmed = { ...obj, [key]: arr.slice(0, 3), truncated: true, totalAvailable: arr.length };
        try {
          json = JSON.stringify(trimmed, (k, v) => (NOISY_FIELDS.has(k) ? undefined : v));
          if (json.length <= TOOL_RESULT_MAX_CHARS) {
            return untrustedDataBlock(
              'نتيجة أداة',
              `${json}\n(تم اقتطاع النتيجة — ${arr.length} عنصراً متاحاً؛ استخدم بحثاً أدق لرؤية البقية)`,
            );
          }
        } catch { /* fall through */ }
      }
    }
  }
  return untrustedDataBlock('نتيجة أداة', `${json.slice(0, TOOL_RESULT_MAX_CHARS)}\n…(نتيجة كبيرة تم اقتصاصها)`);
}

/** Human-readable one-liner for a tool outcome (approval cards + history). Exported for unit tests. */
export function summarizeResult(result: unknown): string {
  if (result === null || result === undefined) return '✅ تم بنجاح';

  if (typeof result === 'string') return result;

  if (typeof result === 'number') return fmtCurrency(result);

  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;

    // Error pattern
    if ('success' in obj && obj.success === false) {
      return `❌ ${String(obj.error ?? 'فشلت العملية')}`;
    }

    // ── Search results with matches ─────────────────────────────────
    if ('matches' in obj && Array.isArray(obj.matches)) {
      const { matches, totalMatches, suggestion } = obj as {
        matches: Record<string, unknown>[];
        totalMatches: number;
        suggestion?: string;
      };
      if (matches.length === 0) {
        // نصيحة الإنشاء الافتراضية: صفر نتائج بلا اقتراح مخصص يجب أن يقترح
        // الإنشاء أو السؤال — الجلسة 2026-09-14 بحثت عن "كنافة" 15 مرة
        // دون أن يقترح المساعد إنشاءها (فقط الحسابات كان يحمل اقتراحاً).
        const tip = suggestion
          ? `\n\n💡 ${String(suggestion)}`
          : '\n\n💡 إن كان الكيان جديداً استخدم أداة الإنشاء المناسبة (مثل sales.create_customer / purchases.create_supplier / inventory.create_product) أو اسأل المستخدم "أتريد إنشاءه؟" قبل المتابعة — ولا تكرر البحث.';
        // Fallback suggestions (e.g. search.accounts expense alternatives)
        // must be VISIBLE on the card — an alternatives list buried only in
        // the model context gets ignored, and the user never sees options.
        const alts = Array.isArray(obj.suggestions) && (obj.suggestions as unknown[]).length > 0
          ? `\n\n🔀 بدائل مقترحة:\n${(obj.suggestions as Record<string, unknown>[]).slice(0, 6).map((s, i) => `${i + 1}. ${String(s.name ?? s.label ?? s.id ?? '')}${s.code || s.id ? ` (${String(s.code ?? s.id)})` : ''}`).join('\n')}${obj.suggestionNote ? `\n${String(obj.suggestionNote)}` : ''}`
          : (obj.suggestionNote ? `\n\n💡 ${String(obj.suggestionNote)}` : '');
        return `❌ لا توجد نتائج.${tip}${alts}`;
      }
      const table = renderTable(matches, `🔍 تم العثور على ${totalMatches ?? matches.length} نتيجة`);
      if (suggestion) return `${table}\n\n💡 ${String(suggestion)}`;
      return table;
    }

    // ── Report / summary with named stats ───────────────────────────
    const statKeys = [
      'invoiceCount', 'invoice_count', 'totalSales', 'total_sales',
      'totalRevenue', 'total_revenue', 'totalExpenses', 'total_expenses',
      'netProfit', 'net_profit', 'totalPaid', 'total_paid',
      'totalOutstanding', 'total_outstanding', 'totalInBase', 'total_in_base',
      'revenue', 'expenses', 'profit', 'total',
    ];

    const hasStats = statKeys.some((k) => k in obj);
    if (hasStats) {
      const lines: string[] = ['📊 **الملخص**\n'];
      const statLabels: Record<string, string> = {
        invoiceCount: '📄 عدد الفواتير',
        invoice_count: '📄 عدد الفواتير',
        totalSales: '💰 إجمالي المبيعات',
        total_sales: '💰 إجمالي المبيعات',
        totalRevenue: '💰 الإيرادات',
        total_revenue: '💰 الإيرادات',
        totalExpenses: '💸 المصروفات',
        total_expenses: '💸 المصروفات',
        netProfit: '📈 صافي الربح',
        net_profit: '📈 صافي الربح',
        totalPaid: '✅ المدفوع',
        total_paid: '✅ المدفوع',
        totalOutstanding: '⏳ المستحق',
        total_outstanding: '⏳ المستحق',
        totalInBase: '🏦 الإجمالي بالأساسية',
        total_in_base: '🏦 الإجمالي بالأساسية',
        revenue: '💰 الإيرادات',
        expenses: '💸 المصروفات',
        profit: '📈 الربح',
        total: '🏷️ الإجمالي',
      };
      for (const [k, v] of Object.entries(obj)) {
        const label = statLabels[k] ?? k.replace(/_/g, ' ');
        if (typeof v === 'number') {
          lines.push(`${label}: ${fmtCurrency(v)}`);
        } else if (v !== null && v !== undefined) {
          lines.push(`${label}: ${String(v)}`);
        }
      }
      return lines.join('\n');
    }

    // ── Array of objects → table ────────────────────────────────────
    if (Array.isArray(obj) && obj.length > 0 && typeof obj[0] === 'object') {
      return renderTable(obj as Record<string, unknown>[]);
    }

    // ── Simple array → numbered list ────────────────────────────────
    if (Array.isArray(obj)) {
      if (obj.length === 0) return '(فارغ)';
      return obj.map((item, i) => `${i + 1}. ${String(item)}`).join('\n');
    }

    // ── Single object with known fields → card ──────────────────────
    const knownFields = ['name', 'customerName', 'customer_name', 'supplierName', 'supplier_name',
      'phone', 'email', 'totalAmount', 'total_amount', 'amount', 'status', 'date',
      'invoiceNumber', 'invoice_number', 'notes'];
    const hasKnown = knownFields.some((k) => k in obj);
    if (hasKnown) {
      const title = 'invoiceNumber' in obj ? '📋 فاتورة' :
        'customerName' in obj ? '👤 عميل' :
        'supplierName' in obj ? '🏢 مورد' :
        'name' in obj ? '👤 بيانات' :
        undefined;
      return renderObject(obj, title);
    }

    // ── Fallback: compact JSON (truncated) ──────────────────────────
    try {
      const json = JSON.stringify(result);
      if (json.length <= 200) return json;
      return json.slice(0, 200) + '...';
    } catch {
      return '✅ تم بنجاح';
    }
  }

  return String(result);
}
