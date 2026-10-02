import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/sales/api', () => ({
  salesApi: { getInvoicesPaginated: vi.fn(), postInvoice: vi.fn() },
}));
vi.mock('@/modules/purchases/api', () => ({
  purchasesApi: { getInvoicesPaginated: vi.fn(), postInvoice: vi.fn() },
}));

import { salesWriteTools } from './sales';
import { purchasesWriteTools } from './purchases';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import type { ToolContext } from '../../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

const UUID = '11111111-1111-4111-8111-111111111111';

function findTool(list: { name: string; execute?: unknown }[], name: string) {
  const t = list.find((x) => x.name === name);
  if (!t || !t.execute) throw new Error(`tool ${name} not found`);
  return t as unknown as {
    execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
  };
}

describe('post_invoice UUID-or-number resolution (live 2026-10-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts directly when given a UUID (no extra lookup)', async () => {
    vi.mocked(salesApi.postInvoice).mockResolvedValue({ success: true } as never);
    const res = (await findTool(salesWriteTools, 'sales.post_invoice').execute(
      { invoiceId: UUID },
      ctx,
    )) as Record<string, unknown>;
    expect(res.posted).toBe(true);
    expect(vi.mocked(salesApi.getInvoicesPaginated)).not.toHaveBeenCalled();
    expect(vi.mocked(salesApi.postInvoice)).toHaveBeenCalledWith(UUID, ctx.companyId);
  });

  it('resolves a human invoice number before posting (sales)', async () => {
    vi.mocked(salesApi.getInvoicesPaginated).mockResolvedValue({
      success: true,
      data: { items: [{ id: UUID, invoiceNumber: 'INV-0001' }] },
    } as never);
    vi.mocked(salesApi.postInvoice).mockResolvedValue({ success: true } as never);
    const res = (await findTool(salesWriteTools, 'sales.post_invoice').execute(
      { invoiceId: 'INV-0001' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.posted).toBe(true);
    expect(vi.mocked(salesApi.postInvoice)).toHaveBeenCalledWith(UUID, ctx.companyId);
  });

  it('resolves a human invoice number before posting (purchases)', async () => {
    vi.mocked(purchasesApi.getInvoicesPaginated).mockResolvedValue({
      success: true,
      data: { items: [{ id: UUID, invoiceNumber: 'PINV-0002' }] },
    } as never);
    vi.mocked(purchasesApi.postInvoice).mockResolvedValue({ success: true } as never);
    const res = (await findTool(purchasesWriteTools, 'purchases.post_invoice').execute(
      { invoiceId: 'PINV-0002' },
      ctx,
    )) as Record<string, unknown>;
    expect(res.posted).toBe(true);
    expect(vi.mocked(purchasesApi.postInvoice)).toHaveBeenCalledWith(UUID, ctx.companyId);
  });

  it('fails loudly with guidance for unknown numbers (never a PG Invalid input)', async () => {
    vi.mocked(salesApi.getInvoicesPaginated).mockResolvedValue({
      success: true,
      data: { items: [] },
    } as never);
    const res = (await findTool(salesWriteTools, 'sales.post_invoice').execute(
      { invoiceId: 'الشجاع' },
      ctx,
    )) as Record<string, unknown>;
    expect(String(res.error)).toContain('لم تُعثر على فاتورة');
    expect(vi.mocked(salesApi.postInvoice)).not.toHaveBeenCalled();
  });

  it('refuses partial number hits (INV-0001 must not post INV-00010)', async () => {
    vi.mocked(salesApi.getInvoicesPaginated).mockResolvedValue({
      success: true,
      data: { items: [{ id: 'other-uuid', invoiceNumber: 'INV-00010' }] },
    } as never);
    const res = (await findTool(salesWriteTools, 'sales.post_invoice').execute(
      { invoiceId: 'INV-0001' },
      ctx,
    )) as Record<string, unknown>;
    expect(String(res.error)).toContain('ليس رقم فاتورة كاملاً');
    expect(vi.mocked(salesApi.postInvoice)).not.toHaveBeenCalled();
  });
});
