import { describe, it, expect, vi } from 'vitest';
import { diagnosticTools } from './diagnosticTools';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
}));
vi.mock('@/core/utils/journalEntryGenerator', () => ({
  getDefaultAccountId: vi.fn(),
}));

import { getDbAdapter } from '@/core/database/adapters';
import { getDefaultAccountId } from '@/core/utils/journalEntryGenerator';

function findTool(name: string) {
  return diagnosticTools.find((t) => t.name === name);
}

/**
 * Contract tests for the diagnostic surface (SQL behaviour is exercised by
 * the migration/live-DB suites; here we pin the CONTRACT: permissions, read
 * safety, parameters, and honest validation errors).
 */
describe('diagnosticTools contract', () => {
  it('registers exactly two tools with accounting.view + read danger', () => {
    expect(diagnosticTools).toHaveLength(2);
    for (const t of diagnosticTools) {
      expect(t.permission).toBe('accounting.view');
      expect(t.dangerLevel).toBe('read');
      expect(t.parameters.type).toBe('object');
    }
  });

  it('diagnose.posting_blockers rejects empty invoiceId with a search hint', async () => {
    const tool = findTool('diagnose.posting_blockers');
    expect(tool).toBeDefined();
    const res = (await tool!.execute({}, { companyId: 'c', userId: 'u' })) as Record<string, unknown>;
    expect(res.error).toMatch(/invoiceId مطلوب/);
  });

  it('diagnose.posting_blockers accepts sales/purchase invoiceType only', () => {
    const tool = findTool('diagnose.posting_blockers');
    const props = (tool!.parameters as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(props.invoiceType.enum).toEqual(['sales', 'purchase']);
  });

  it('diagnose.unbalanced_entries exposes optional date filters only', () => {
    const tool = findTool('diagnose.unbalanced_entries');
    const props = (tool!.parameters as { properties: Record<string, unknown>, required?: string[] }).properties;
    expect(Object.keys(props)).toEqual(['fromDate', 'toDate']);
    expect((tool!.parameters as { required?: string[] }).required).toBeUndefined();
  });

  it('both tools describe guidance output (تشخيص + إرشاد)', () => {
    for (const t of diagnosticTools) {
      expect(t.descriptionAr).toMatch(/تشخيص|فحص/);
      expect(t.descriptionAr.length).toBeGreaterThan(40);
    }
  });

  it('P1: a healthy draft with resolvable defaults reports canPost:true (no phantom blockers)', async () => {
    // The old code checked nonexistent keys (default_ar/default_ap), so
    // EVERY healthy draft reported a blocking defect. Resolution now goes
    // through getDefaultAccountId (row + hardcoded fallback).
    vi.mocked(getDbAdapter).mockResolvedValue({
      query: vi.fn(async () => ({
        success: true,
        rows: [{
          id: 'inv-1', invoice_number: 'INV-0001', status: 'draft',
          total_amount: 1000, paid_amount: 0, payment_type: 'credit',
          cash_box_id: null, vat_amount: 0, company_id: 'c1',
          party_name: 'عميل', cash_box_name: null, cash_box_account: null,
        }],
      })),
    } as never);
    vi.mocked(getDefaultAccountId).mockResolvedValue('acc-1');

    const tool = findTool('diagnose.posting_blockers');
    const res = (await tool!.execute(
      { invoiceId: '00000000-0000-0000-0000-000000000001' },
      { companyId: 'c1', userId: 'u1' },
    )) as Record<string, unknown>;

    expect(res.canPost).toBe(true);
    expect(res.blockingCount).toBe(0);
    // Resolved via the REAL keys (row-or-fallback), never the dead ones
    expect(vi.mocked(getDefaultAccountId)).toHaveBeenCalledWith('c1', 'default_debtors');
    expect(vi.mocked(getDefaultAccountId)).toHaveBeenCalledWith('c1', 'default_sales');
  });

  it('P1: unresolvable defaults still block with an actionable fix', async () => {
    vi.mocked(getDbAdapter).mockResolvedValue({
      query: vi.fn(async () => ({
        success: true,
        rows: [{
          id: 'inv-1', invoice_number: 'INV-0001', status: 'draft',
          total_amount: 1000, paid_amount: 0, payment_type: 'credit',
          cash_box_id: null, vat_amount: 0, company_id: 'c1',
          party_name: 'عميل', cash_box_name: null, cash_box_account: null,
        }],
      })),
    } as never);
    vi.mocked(getDefaultAccountId).mockResolvedValue(null);

    const tool = findTool('diagnose.posting_blockers');
    const res = (await tool!.execute(
      { invoiceId: '00000000-0000-0000-0000-000000000001' },
      { companyId: 'c1', userId: 'u1' },
    )) as Record<string, unknown>;

    expect(res.canPost).toBe(false);
    const blockers = res.blockers as Array<{ fix: string }>;
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers[0].fix).toMatch(/الحسابات الافتراضية/);
  });
});
