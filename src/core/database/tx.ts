import { getDbAdapter } from '@/core/database/adapters';
import type { JournalEntryLine } from '@/core/utils/journalEntryGenerator';

/**
 * Transactional write helpers.
 *
 * Every multi-table business mutation MUST run inside a single database
 * transaction so that either all related records change together (accounts,
 * stock, documents) or none do. Both adapters implement this via real
 * BEGIN / COMMIT / ROLLBACK:
 *  - Electron: db:internal-transaction channel with per-statement guards.
 *  - PGlite (web/tests): local BEGIN/COMMIT/ROLLBACK.
 */

export interface TxStatement {
  sql: string;
  params?: unknown[];
}

export type TxResult = { success: true; results: unknown[] } | { success: false; error: string };

/** Execute all statements atomically; any failure rolls back everything. */
export async function runTransaction(queries: TxStatement[]): Promise<TxResult> {
  const adapter = await getDbAdapter();
  const result = await adapter.transaction(queries);
  if (!result.success) return { success: false, error: result.error || 'Transaction failed' };
  return { success: true, results: (result.results || []) as unknown[] };
}

export interface JournalEntryInput {
  reference: string;
  description: string;
  /** YYYY-MM-DD */
  date: string;
  totalAmount: number;
  entries: JournalEntryLine[];
}

/**
 * Build the parameterized statement that inserts a transactions header +
 * its journal_entries lines using a single CTE (same shape the adapters
 * use internally). Include it as one statement inside runTransaction batches.
 */
export function buildJournalEntryStatement(companyId: string, entry: JournalEntryInput): TxStatement {
  const valueRows = entry.entries.map((_, idx) => {
    const base = 7 + idx * 4;
    return `((SELECT id FROM new_tx), $${base}::uuid, $${base + 1}::numeric, $${base + 2}::numeric, $${base + 3}, $6::uuid)`;
  }).join(', ');

  return {
    sql: `
      WITH new_tx AS (
        INSERT INTO transactions (company_id, date, reference, description, total_amount, status)
        VALUES ($1::uuid, $2::timestamptz, $3, $4, $5::numeric, 'posted')
        RETURNING id
      )
      INSERT INTO journal_entries (transaction_id, account_id, debit, credit, memo, company_id)
      VALUES ${valueRows}
    `,
    params: [
      companyId,
      entry.date,
      entry.reference,
      entry.description,
      entry.totalAmount,
      companyId,
      ...entry.entries.flatMap((l) => [l.accountId, l.debit, l.credit, l.memo ?? null]),
    ],
  };
}
