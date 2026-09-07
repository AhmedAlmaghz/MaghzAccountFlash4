import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/core/api', () => ({
  coreApi: { getCompany: vi.fn() },
}));

import { coreApi } from '@/modules/core/api';
import { directionTools } from './directionTools';
import { registerTool, clearToolRegistry } from './registry';
import type { ToolContext } from '../types';

const mockedGetCompany = vi.mocked(coreApi.getCompany);
const ctx: ToolContext = { companyId: 'c1', userId: 'u1' };
const tool = directionTools[0];

const COMPANY = {
  id: 'c1', name: 'شركة الأمل للتجارة', nameEn: 'AlAmal', currency: 'YER',
  taxNumber: '123456', phone: '777123456',
};

describe('ai.classify_document', () => {
  beforeEach(() => {
    clearToolRegistry();
    vi.clearAllMocks();
    for (const t of directionTools) registerTool(t);
    mockedGetCompany.mockResolvedValue({ success: true, data: COMPANY as never });
  });

  it('is a read tool gated by ai.use', () => {
    expect(directionTools).toHaveLength(1);
    expect(tool.dangerLevel).toBe('read');
    expect(tool.permission).toBe('ai.use');
  });

  it('returns same + own tool for our documents', async () => {
    const out = (await tool.execute(
      { docTool: 'sales.create_invoice', issuerName: 'شركة الأمل للتجارة' }, ctx,
    )) as Record<string, unknown>;
    expect(out.direction).toBe('same');
    expect(out.mappedTool).toBe('sales.create_invoice');
    expect(String(out.badge)).toMatch(/كما هو/);
  });

  it('returns external + mirror tool for third-party documents', async () => {
    const out = (await tool.execute(
      { docTool: 'sales.create_invoice', issuerName: 'مؤسسة النور', issuerTaxNumber: '999999' }, ctx,
    )) as Record<string, unknown>;
    expect(out.direction).toBe('external');
    expect(out.mappedTool).toBe('purchases.create_invoice');
    expect(String(out.badge)).toContain('purchases.create_invoice');
  });

  it('mirrors vouchers both ways', async () => {
    const out = (await tool.execute(
      { docTool: 'accounting.create_receipt_voucher', issuerName: 'مؤسسة النور' }, ctx,
    )) as Record<string, unknown>;
    expect(out.direction).toBe('external');
    expect(out.mappedTool).toBe('accounting.create_payment_voucher');
  });

  it('returns null mappedTool when ambiguous (must ask)', async () => {
    const out = (await tool.execute({ docTool: 'sales.create_invoice' }, ctx)) as Record<string, unknown>;
    expect(out.direction).toBe('ambiguous');
    expect(out.mappedTool).toBeNull();
    expect(String(out.badge)).toMatch(/غامض/);
  });

  it('returns null mappedTool when no mirror exists', async () => {
    const out = (await tool.execute(
      { docTool: 'sales.create_quotation', issuerName: 'مؤسسة النور' }, ctx,
    )) as Record<string, unknown>;
    expect(out.direction).toBe('external');
    expect(out.mappedTool).toBeNull();
    expect(String(out.badge)).toMatch(/لا توجد أداة مرآة/);
  });

  it('fails honestly when the company profile is unreadable', async () => {
    mockedGetCompany.mockResolvedValue({ success: false, error: 'DB down' });
    const out = (await tool.execute({ docTool: 'sales.create_invoice' }, ctx)) as Record<string, unknown>;
    expect(out.error).toBe('DB down');
  });

  it('requires docTool', async () => {
    const out = (await tool.execute({}, ctx)) as Record<string, unknown>;
    expect(out.error).toMatch(/docTool/);
  });
});
