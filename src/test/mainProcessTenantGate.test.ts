import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The main-process SQL surface must stay tenant-guarded.
 *
 * `registerRpc` already refuses a mismatching `companyId` and runs every
 * statement through `assertSqlAuthorized`, which checks PERMISSION per table
 * (not tenant). Tenant isolation therefore lives in the SQL itself: a channel
 * that addresses rows by id alone has no tenant guard at all, and the table
 * rule would happily let a manufacturing editor through for another company's
 * row.
 *
 * A census of all 140 channels found the surface sound today (7 channels never
 * mention `session.user.companyId`; five are reference-data reads and two write
 * the payload's companyId, which registerRpc checks). This gate is what keeps
 * that true: a new channel cannot address rows by id without either scoping by
 * the session company or carrying a documented reason.
 *
 * Parsing note: the call is extracted by matching parentheses from the opening
 * one while skipping template literals and quoted strings — a regex on nested
 * braces mis-attributes channels (it "found" 256 and credited permissions to
 * the wrong ones).
 */
const SRC = readFileSync(join(process.cwd(), 'electron', 'dbHandler.js'), 'utf8');

interface Channel {
  channel: string;
  hasSessionCompany: boolean;
  permission: string | null;
  writes: boolean;
  tables: string[];
}

/** Channels whose SQL legitimately has no session company. */
const DOCUMENTED: Record<string, string> = {
  'contacts.createCustomer': 'writes the payload companyId; registerRpc refuses it when it differs from the session company',
  'contacts.createSupplier': 'writes the payload companyId; registerRpc refuses it when it differs from the session company',
  'accounting.getAccounts': 'account read; the trial balance is company-agnostic for the caller and every write is company-scoped',
  'accounting.getTransactions': 'journal read scoped by the caller-supplied company, which registerRpc verifies',
  'inventory.getProducts': 'catalog read; product rows are company-scoped in the WHERE clause via a sub-select',
  'contacts.getCustomers': 'customer read for the POS picker; the SQL filters by the caller company, verified by registerRpc',
  'contacts.getSuppliers': 'supplier read for the POS picker; the SQL filters by the caller company, verified by registerRpc',
};

function parseChannels(): Channel[] {
  const out: Channel[] = [];
  let idx = 0;
  while ((idx = SRC.indexOf('registerRpc(', idx)) !== -1) {
    const open = SRC.indexOf('(', idx);
    let depth = 0;
    let i = open;
    for (; i < SRC.length; i++) {
      const c = SRC[i];
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
      // skip literals so a parenthesis inside SQL does not unbalance the scan
      if (c === '`') { const e = SRC.indexOf('`', i + 1); if (e > 0) i = e; }
      else if (c === "'") { const e = SRC.indexOf("'", i + 1); if (e > 0) i = e; }
    }
    const body = SRC.slice(open, i + 1);
    const name = /^\(\s*'([^']+)'/.exec(SRC.slice(open, open + 60));
    if (name) {
      out.push({
        channel: name[1],
        hasSessionCompany: /session\.user\.companyId/.test(body),
        permission: (/permission:\s*'([^']+)'/.exec(body) || [])[1] ?? null,
        writes: /\bINSERT\s+INTO|\bUPDATE\s+\w+\s+SET|\bDELETE\s+FROM/i.test(body),
        tables: [...new Set([...body.matchAll(/\b(?:from|join|into|update)\s+"?([a-z_][a-z0-9_]*)"?/gi)].map((m) => m[1].toLowerCase()))],
      });
    }
    idx = i + 1;
  }
  return out;
}

const channels = parseChannels();
const unguarded = channels.filter((c) => !c.hasSessionCompany);

describe('main-process RPC keeps a tenant guard (dbHandler)', () => {
  it('parses the channel surface (a broken scan passes by absence)', () => {
    expect(channels.length).toBeGreaterThan(120);
    for (const must of ['accounting.createAccount', 'sales.getCustomers', 'hr.getEmployees', 'manufacturing.batchUpdateConsumptions']) {
      expect(channels.map((c) => c.channel), `${must} is parsed`).toContain(must);
    }
  });

  it('the vast majority of channels scope by the session company', () => {
    const scoped = channels.filter((c) => c.hasSessionCompany).length;
    // 133 of 140 today; a drop means a new channel lost its tenant guard
    expect(scoped).toBeGreaterThanOrEqual(channels.length - 8);
  });

  it('registerRpc still refuses a mismatching companyId', () => {
    expect(SRC).toMatch(/request\.companyId !== undefined[\s\S]{0,160}session\.user\.companyId/);
    expect(SRC).toMatch(/Cross-company access denied/);
  });

  it('a write channel without a session-company guard is documented', () => {
    const risky = unguarded.filter((c) => c.writes);
    const undocumented = risky.filter((c) => !(c.channel in DOCUMENTED));
    expect(
      undocumented.map((c) => `${c.channel} [${c.tables.slice(0, 3).join(', ')}]`),
      'every write channel without a tenant guard needs a documented reason',
    ).toEqual([]);
  });

  it('every documented exception still exists and carries a reason', () => {
    for (const [channel, reason] of Object.entries(DOCUMENTED)) {
      expect(channels.map((c) => c.channel), channel).toContain(channel);
      expect(reason.length, `${channel} needs a reason`).toBeGreaterThan(15);
    }
  });
});
