/**
 * Unified opening-balance integration (Odoo / QuickBooks style).
 *
 * Golden rule: a balance or a statement is meaningless unless it includes the
 * opening balance. Every statement/balance/aging in the app must resolve to
 * `opening + movement` — this module centralizes the SQL fragments and the
 * helpers so all call sites (statements, aging, GL reports) stay consistent.
 *
 * Conventions:
 *  - Customers/suppliers opening balances live on their own rows
 *    (`customers.opening_balance`, `suppliers.opening_balance`) and were
 *    already posted to the GL through Opening Balance Equity (31201).
 *  - Statement rows are produced as a single UNION ALL with an explicit
 *    leading "opening balance" row, then a running SUM window so the LAST
 *    row's balance always equals the entity's FULL balance
 *    (opening + invoices - receipts).
 *  - Aging: an opening balance with no due date is, by definition, the oldest
 *    debt → it always lands in the 90+ bucket.
 */

/** SQL fragment: the opening-balance row for a customer statement. sort_type 0 puts it first. */
export const CUSTOMER_OPENING_ROW_SQL = `
  SELECT c.opening_date::text AS date, 'رصيد افتتاحي'::varchar AS document_type,
         'OPENING'::varchar AS document_number,
         CASE WHEN c.opening_balance >= 0 THEN c.opening_balance ELSE 0 END AS debit,
         CASE WHEN c.opening_balance < 0 THEN -c.opening_balance ELSE 0 END AS credit,
         NULL::text AS notes,
         COALESCE(c.opening_date, '1900-01-01'::date) AS sort_date, 0 AS sort_type
  FROM customers c
  WHERE c.id = $1::uuid AND c.company_id = $2::uuid AND c.opening_balance <> 0
`;

/** SQL fragment: the opening-balance row for a supplier statement. */
export const SUPPLIER_OPENING_ROW_SQL = `
  SELECT s.opening_date::text AS date, 'رصيد افتتاحي'::varchar AS document_type,
         'OPENING'::varchar AS document_number,
         CASE WHEN s.opening_balance < 0 THEN -s.opening_balance ELSE 0 END AS debit,
         CASE WHEN s.opening_balance >= 0 THEN s.opening_balance ELSE 0 END AS credit,
         NULL::text AS notes,
         COALESCE(s.opening_date, '1900-01-01'::date) AS sort_date, 0 AS sort_type
  FROM suppliers s
  WHERE s.id = $1::uuid AND s.company_id = $2::uuid AND s.opening_balance <> 0
`;

/**
 * Postgres window frame shared by all statement queries. Because every
 * statement now begins with the opening row (sort_type 0), the running
 * SUM carries the opening forward through every movement.
 */
export const STATEMENT_RUNNING_BALANCE_SQL = `
  SUM(debit - credit) OVER (ORDER BY sort_date, sort_type, document_number)
`;

/** JS fallback when a mapped row needs its opening shown but SQL couldn't be reused. */
export function isOpeningRow(row: { documentType?: string; document_type?: string }): boolean {
  const t = row.documentType ?? row.document_type ?? '';
  return t === 'رصيد افتتاحي' || t === 'OPENING' || t === 'Opening';
}
