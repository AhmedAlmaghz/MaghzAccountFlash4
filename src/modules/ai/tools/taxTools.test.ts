import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/tax/engine', () => ({
  getCompanyTaxContext: vi.fn(),
  setCompanyTaxContext: vi.fn(),
  openTaxPeriod: vi.fn(),
  setTaxPeriodStatus: vi.fn(),
  listTaxPeriods: vi.fn(),
  computeVatReturn: vi.fn(),
}));

vi.mock('@/modules/accounting/api', () => ({
  accountingApi: { revalueForeignBalances: vi.fn() },
}));

vi.mock('@/modules/hr/api', () => ({
  hrApi: { postLeaveProvision: vi.fn() },
}));

import {
  getCompanyTaxContext,
  setCompanyTaxContext,
  openTaxPeriod,
  setTaxPeriodStatus,
  listTaxPeriods,
  computeVatReturn,
} from '@/modules/tax/engine';
import { accountingApi } from '@/modules/accounting/api';
import { hrApi } from '@/modules/hr/api';
import { taxTools } from './taxTools';
import { ALL_PERMISSIONS } from '@/modules/auth/types';
import type { ToolContext } from '../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

const PERIOD_ID = '00000000-0000-0000-0000-000000000010';
const PERIOD = {
  id: PERIOD_ID, companyId: ctx.companyId, countryCode: 'SA',
  periodType: 'monthly', startDate: '2026-01-01', endDate: '2026-01-31',
  status: 'open', filedAt: null,
};

interface TestableTool {
  permission: string;
  dangerLevel: string;
  summarizeArgs?: (a: Record<string, unknown>) => string;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

function findTool(name: string): TestableTool {
  const t = taxTools.find((x) => x.name === name);
  if (!t || !t.execute) throw new Error(`tool ${name} not found`);
  return t as unknown as TestableTool;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('settings.get_tax_country / settings.set_tax_country', () => {
  it('returns country, rate and profile currency', async () => {
    vi.mocked(getCompanyTaxContext).mockResolvedValue({
      companyId: ctx.companyId, countryCode: 'SA', timezone: 'Asia/Riyadh',
      profile: { vat: { standard: 0.15 }, registration: { currency: 'SAR' } },
    } as never);
    const res = (await findTool('settings.get_tax_country').execute({}, ctx)) as Record<string, unknown>;
    expect(vi.mocked(getCompanyTaxContext)).toHaveBeenCalledWith(ctx.companyId);
    expect(res.countryCode).toBe('SA');
    expect(res.vatRate).toBe(0.15);
  });

  it('sets a valid country and rejects unknown codes', async () => {
    vi.mocked(setCompanyTaxContext).mockResolvedValue({ success: true });
    const res = (await findTool('settings.set_tax_country').execute({ countryCode: 'ae' }, ctx)) as Record<string, unknown>;
    expect(res.updated).toBe(true);
    expect(vi.mocked(setCompanyTaxContext)).toHaveBeenCalledWith(ctx.companyId, 'AE', '');
    const bad = (await findTool('settings.set_tax_country').execute({ countryCode: 'US' }, ctx)) as Record<string, unknown>;
    expect(bad.error).toBeDefined();
  });
});

describe('tax period lifecycle', () => {
  it('opens with validated dates, defaulting country from context', async () => {
    vi.mocked(getCompanyTaxContext).mockResolvedValue({
      companyId: ctx.companyId, countryCode: 'YE', timezone: '', profile: {},
    } as never);
    vi.mocked(openTaxPeriod).mockResolvedValue({ success: true, id: PERIOD_ID });
    const res = (await findTool('tax.open_period').execute(
      { startDate: '2026-01-01', endDate: '2026-01-31' }, ctx
    )) as Record<string, unknown>;
    expect(res.opened).toBe(true);
    expect(vi.mocked(openTaxPeriod)).toHaveBeenCalledWith(
      ctx.companyId,
      expect.objectContaining({ countryCode: 'YE', startDate: '2026-01-01', endDate: '2026-01-31' })
    );
  });

  it('rejects inverted ranges without calling the API', async () => {
    const res = (await findTool('tax.open_period').execute(
      { startDate: '2026-02-01', endDate: '2026-01-31' }, ctx
    )) as Record<string, unknown>;
    expect(res.error).toBeDefined();
    expect(vi.mocked(openTaxPeriod)).not.toHaveBeenCalled();
  });

  it('closes and files by period id', async () => {
    vi.mocked(setTaxPeriodStatus).mockResolvedValue({ success: true });
    const closed = (await findTool('tax.close_period').execute({ periodId: PERIOD_ID }, ctx)) as Record<string, unknown>;
    expect(closed.closed).toBe(true);
    expect(vi.mocked(setTaxPeriodStatus)).toHaveBeenCalledWith(ctx.companyId, PERIOD_ID, 'closed');
    const filed = (await findTool('tax.file_period').execute({ periodId: PERIOD_ID }, ctx)) as Record<string, unknown>;
    expect(filed.filed).toBe(true);
    expect(vi.mocked(setTaxPeriodStatus)).toHaveBeenCalledWith(ctx.companyId, PERIOD_ID, 'filed');
  });
});

describe('tax.vat_return', () => {
  it('resolves the period then computes the return', async () => {
    vi.mocked(listTaxPeriods).mockResolvedValue([PERIOD] as never);
    vi.mocked(computeVatReturn).mockResolvedValue({
      success: true,
      data: { outputVat: 1500, inputVat: 400, netPayable: 1100, payable: true, currencyCode: 'SAR' },
    } as never);
    const res = (await findTool('tax.vat_return').execute({ periodId: PERIOD_ID }, ctx)) as Record<string, unknown>;
    expect(vi.mocked(computeVatReturn)).toHaveBeenCalledWith(ctx.companyId, PERIOD);
    expect(res.netPayable).toBe(1100);
  });

  it('errors honestly on unknown periods', async () => {
    vi.mocked(listTaxPeriods).mockResolvedValue([]);
    const res = (await findTool('tax.vat_return').execute({ periodId: PERIOD_ID }, ctx)) as Record<string, unknown>;
    expect(res.error).toBeDefined();
    expect(vi.mocked(computeVatReturn)).not.toHaveBeenCalled();
  });
});

describe('accounting.revalue_fx / hr.post_leave_provision', () => {
  it('passes company, user and date through to revaluation', async () => {
    vi.mocked(accountingApi.revalueForeignBalances).mockResolvedValue({
      success: true, data: { reference: 'FX-20260131', lines: 3, gain: 0, loss: 50, currencies: ['USD'] },
    } as never);
    const res = (await findTool('accounting.revalue_fx').execute({ date: '2026-01-31' }, ctx)) as Record<string, unknown>;
    expect(res.revalued).toBe(true);
    expect(vi.mocked(accountingApi.revalueForeignBalances)).toHaveBeenCalledWith(ctx.companyId, ctx.userId, '2026-01-31');
  });

  it('rejects malformed dates and years before touching the APIs', async () => {
    const badDate = (await findTool('accounting.revalue_fx').execute({ date: '31-01-2026' }, ctx)) as Record<string, unknown>;
    expect(badDate.error).toBeDefined();
    const badYear = (await findTool('hr.post_leave_provision').execute({ year: 1999 }, ctx)) as Record<string, unknown>;
    expect(badYear.error).toBeDefined();
    expect(vi.mocked(accountingApi.revalueForeignBalances)).not.toHaveBeenCalled();
    expect(vi.mocked(hrApi.postLeaveProvision)).not.toHaveBeenCalled();
  });

  it('posts the leave provision for an explicit year', async () => {
    vi.mocked(hrApi.postLeaveProvision).mockResolvedValue({
      success: true, data: { reference: 'LEAVE-2024', employees: 5, amount: 12000 },
    } as never);
    const res = (await findTool('hr.post_leave_provision').execute({ year: 2024 }, ctx)) as Record<string, unknown>;
    expect(res.posted).toBe(true);
    expect(vi.mocked(hrApi.postLeaveProvision)).toHaveBeenCalledWith(ctx.companyId, 2024, ctx.userId);
  });
});

describe('tax tools contract', () => {
  it('uses valid permissions, namespaced names and write summaries', () => {
    const valid = new Set<string>([...ALL_PERMISSIONS, '*']);
    for (const t of taxTools) {
      expect(valid.has(t.permission), `${t.name} permission`).toBe(true);
      expect(t.name).toMatch(/^[a-z][a-z0-9]*\.[a-z0-9_]+$/);
      expect(t.parameters?.type).toBe('object');
      if (t.dangerLevel === 'write') {
        expect(typeof t.summarizeArgs, `${t.name} summarizeArgs`).toBe('function');
      }
    }
    expect(findTool('settings.get_tax_country').permission).toBe('settings.view');
    expect(findTool('settings.set_tax_country').permission).toBe('settings.edit');
    expect(findTool('tax.open_period').permission).toBe('accounting.create');
    expect(findTool('tax.close_period').permission).toBe('accounting.edit');
    expect(findTool('tax.file_period').permission).toBe('accounting.post');
    expect(findTool('accounting.revalue_fx').permission).toBe('accounting.post');
    // hr defines no .post grant — post-like HR tools gate on hr.edit (hr.post_payroll_run precedent)
    expect(findTool('hr.post_leave_provision').permission).toBe('hr.edit');
  });
});
