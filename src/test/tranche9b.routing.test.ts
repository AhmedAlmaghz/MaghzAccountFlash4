import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isElectronPg } from '@/core/database/adapters';
import { inventoryApi } from '@/modules/inventory/api';
import { accountingApi } from '@/modules/accounting/api';

/**
 * Payload shape for the four functions this tranche moved onto channels.
 *
 * The point of a channel is that the renderer cannot steer it, so the payload is
 * the whole security surface: it must carry the id and nothing the caller chose
 * to add. These assertions are deliberately blunt — no adapter may be touched,
 * and no tenant, audit or status field may appear — because a test that only
 * checked "it called the surface" would pass while the payload grew a companyId
 * that this channel happens to ignore and the next one would not.
 */
vi.mock('@/core/utils/validation', async (orig) => {
  const actual = await orig<typeof import('@/core/utils/validation')>();
  return { ...actual, validateInput: vi.fn(() => ({ success: true })) };
});

const query = vi.fn(() => Promise.resolve({ success: true, rows: [] }));
vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(async () => ({ query, transaction: vi.fn(), ping: vi.fn(async () => ({ success: true })) })),
  isElectronPg: vi.fn(() => true),
  getDbMode: vi.fn(() => 'pg'),
}));

const inv = { updateWarehouse: vi.fn(async () => ({ success: true })), updateStockAdjustment: vi.fn(async () => ({ success: true })) };
const acc = { deleteReceiptVoucher: vi.fn(async () => ({ success: true })), deletePaymentVoucher: vi.fn(async () => ({ success: true })) };

const ID = '00000000-0000-0000-0000-0000000000aa';
const COMPANY = '00000000-0000-0000-0000-0000000000bb';

function setWindow(surfaces: Record<string, unknown>): void {
  (globalThis as unknown as { window: Record<string, unknown> }).window = { electronDB: surfaces };
}

beforeEach(() => {
  query.mockClear();
  for (const m of [...Object.values(inv), ...Object.values(acc)]) m.mockClear();
  setWindow({ inventory: inv, accounting: acc });
});

describe('inventory partial updates travel as the changed keys only', () => {
  it('updateWarehouse sends the id and the edited fields, and no company or user', async () => {
    await inventoryApi.updateWarehouse(ID, COMPANY, { name: 'المستودع', isActive: false });

    expect(inv.updateWarehouse).toHaveBeenCalledTimes(1);
    const payload = inv.updateWarehouse.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual({ id: ID, name: 'المستودع', isActive: false });
    for (const leaked of ['companyId', 'company_id', 'updatedBy', 'updated_by', '_userId']) {
      expect(payload, leaked + ' must not cross the bridge').not.toHaveProperty(leaked);
    }
    expect(query, 'the desktop path must not fall through to raw SQL').not.toHaveBeenCalled();
  });

  it('updateStockAdjustment cannot smuggle a status past the channel', async () => {
    await inventoryApi.updateStockAdjustment(ID, COMPANY, { actualQty: 3, status: 'posted' } as never);

    // Forwarded verbatim, because the channel is what decides which columns
    // exist — filtering it here would hide the fact that the caller sent it.
    // What matters is that the channel drops it: asserted on the composed
    // statement in partialUpdateAllowlistGate, and against a live row in
    // voucherDelete.integration.
    const payload = inv.updateStockAdjustment.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe('posted');
    expect(payload.companyId).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it('reports a missing surface instead of silently using raw SQL', async () => {
    setWindow({});
    const res = await inventoryApi.updateWarehouse(ID, COMPANY, { name: 'x' });
    expect(res).toEqual({ success: false, error: 'RPC unavailable' });
    expect(query, 'falling back to raw SQL would bypass the channel guard').not.toHaveBeenCalled();
  });
});

describe('the guarded voucher deletes travel as an id only', () => {
  it.each([
    ['deleteReceiptVoucher', 'deleteReceiptVoucher'],
    ['deletePaymentVoucher', 'deletePaymentVoucher'],
  ] as const)('%s sends the id and nothing else', async (method, channelMethod) => {
    const res = await accountingApi[method](ID, COMPANY);

    expect(acc[channelMethod]).toHaveBeenCalledTimes(1);
    const payload = acc[channelMethod].mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['id']);
    expect(payload.id).toBe(ID);
    expect(query, 'the guard must live in the channel, not in renderer SQL').not.toHaveBeenCalled();
    expect(res.success).toBe(true);
  });

  it('passes the channel refusal through instead of replacing it', async () => {
    acc.deleteReceiptVoucher.mockResolvedValueOnce({ success: false, error: 'Cannot delete a posted voucher' });
    const res = await accountingApi.deleteReceiptVoucher(ID, COMPANY);
    // The four reasons are the channel's to decide; the renderer's job is to
    // relay them verbatim rather than swallow them into a generic failure.
    expect(res).toEqual({ success: false, error: 'Cannot delete a posted voucher' });
  });

  it('reports a missing accounting surface', async () => {
    setWindow({ inventory: inv });
    const res = await accountingApi.deletePaymentVoucher(ID, COMPANY);
    expect(res).toEqual({ success: false, error: 'RPC unavailable' });
    expect(query).not.toHaveBeenCalled();
  });

  it('never carries the company across the bridge, so a caller cannot aim at another tenant', async () => {
    await accountingApi.deleteReceiptVoucher(ID, COMPANY);
    const payload = acc.deleteReceiptVoucher.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('companyId');
    expect(payload).not.toHaveProperty('company_id');
  });
});

describe('the browser path is untouched', () => {
  it('still issues raw SQL when the database is not the desktop pool', async () => {
    vi.mocked(isElectronPg).mockReturnValueOnce(false);
    const res = await inventoryApi.updateWarehouse(ID, COMPANY, { name: 'محلي' });

    expect(inv.updateWarehouse).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE warehouses SET');
    expect(sql).toContain('company_id = $');
    expect(sql, 'the phantom column must stay gone here too').not.toContain('updated_at');
    expect(params).toEqual(['محلي', null, ID, COMPANY]);
    expect(res.success).toBe(true);
  });
});