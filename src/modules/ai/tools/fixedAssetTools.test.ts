import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/modules/accounting/assets', () => ({
  fixedAssetsApi: {
    getFixedAssets: vi.fn(),
    createFixedAsset: vi.fn(),
    disposeFixedAsset: vi.fn(),
  },
}));

import { fixedAssetsApi } from '@/modules/accounting/assets';
import { fixedAssetTools } from './fixedAssetTools';
import { ALL_PERMISSIONS } from '@/modules/auth/types';
import type { ToolContext } from '../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-000000000001',
  userId: '00000000-0000-0000-0000-000000000002',
};

const ASSET_ID = '00000000-0000-0000-0000-000000000010';
const BOX_ID = '00000000-0000-0000-0000-000000000020';

interface TestableTool {
  permission: string;
  dangerLevel: string;
  summarizeArgs?: (a: Record<string, unknown>) => string;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

function findTool(name: string): TestableTool {
  const t = fixedAssetTools.find((x) => x.name === name);
  if (!t || !t.execute) throw new Error(`tool ${name} not found`);
  return t as unknown as TestableTool;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('accounting.list_fixed_assets', () => {
  it('calls the API with the session companyId', async () => {
    vi.mocked(fixedAssetsApi.getFixedAssets).mockResolvedValue({ success: true, data: [] });
    const res = (await findTool('accounting.list_fixed_assets').execute({}, ctx)) as Record<string, unknown>;
    expect(vi.mocked(fixedAssetsApi.getFixedAssets)).toHaveBeenCalledWith(ctx.companyId);
    expect(res.total).toBe(0);
  });
});

describe('accounting.create_fixed_asset', () => {
  const valid = { name: 'مكيف سبليت', cost: 50000, usefulLifeMonths: 60 };

  it('creates with defaults (today, straight_line, cash is explicit)', async () => {
    vi.mocked(fixedAssetsApi.createFixedAsset).mockResolvedValue({ success: true, id: ASSET_ID, code: 'FA-0001' });
    const res = (await findTool('accounting.create_fixed_asset').execute(
      { ...valid, funding: 'opening' },
      ctx
    )) as Record<string, unknown>;
    expect(res.created).toBe(true);
    expect(res.code).toBe('FA-0001');
    const payload = vi.mocked(fixedAssetsApi.createFixedAsset).mock.calls[0][0] as Record<string, unknown>;
    expect(payload.companyId).toBe(ctx.companyId);
    expect(payload.nameAr).toBe('مكيف سبليت');
    expect(payload.method).toBe('straight_line');
  });

  it('rejects zero cost and bad life before touching the API', async () => {
    const zero = (await findTool('accounting.create_fixed_asset').execute(
      { name: 'x', cost: 0, usefulLifeMonths: 60, funding: 'opening' }, ctx
    )) as Record<string, unknown>;
    expect(zero.error).toBeDefined();
    const badLife = (await findTool('accounting.create_fixed_asset').execute(
      { name: 'x', cost: 100, usefulLifeMonths: 0, funding: 'opening' }, ctx
    )) as Record<string, unknown>;
    expect(badLife.error).toBeDefined();
    expect(vi.mocked(fixedAssetsApi.createFixedAsset)).not.toHaveBeenCalled();
  });

  it('requires a cash box for cash funding and rejects bad methods', async () => {
    const noBox = (await findTool('accounting.create_fixed_asset').execute(
      { ...valid, funding: 'cash' }, ctx
    )) as Record<string, unknown>;
    expect(noBox.error).toBeDefined();
    const badMethod = (await findTool('accounting.create_fixed_asset').execute(
      { ...valid, funding: 'opening', method: 'sum_of_years' }, ctx
    )) as Record<string, unknown>;
    expect(badMethod.error).toBeDefined();
    expect(vi.mocked(fixedAssetsApi.createFixedAsset)).not.toHaveBeenCalled();
  });

  it('rejects salvage >= cost', async () => {
    const res = (await findTool('accounting.create_fixed_asset').execute(
      { ...valid, funding: 'opening', salvageValue: 50000 }, ctx
    )) as Record<string, unknown>;
    expect(res.error).toBeDefined();
    expect(vi.mocked(fixedAssetsApi.createFixedAsset)).not.toHaveBeenCalled();
  });
});

describe('accounting.dispose_fixed_asset', () => {
  it('disposes with proceeds and passes the reason through', async () => {
    vi.mocked(fixedAssetsApi.disposeFixedAsset).mockResolvedValue({
      success: true, data: { reference: 'DSP-FA-0001', gain: 1000, loss: 0 },
    });
    const res = (await findTool('accounting.dispose_fixed_asset').execute(
      { assetId: ASSET_ID, proceeds: 10000, cashBoxId: BOX_ID, reason: 'بيع لانتهاء العمر' }, ctx
    )) as Record<string, unknown>;
    expect(res.disposed).toBe(true);
    expect(res.reference).toBe('DSP-FA-0001');
    expect(vi.mocked(fixedAssetsApi.disposeFixedAsset)).toHaveBeenCalledWith(
      ctx.companyId, ASSET_ID,
      expect.objectContaining({ proceeds: 10000, cashBoxId: BOX_ID }),
      ctx.userId
    );
  });

  it('rejects short reasons and proceeds without a cash box', async () => {
    const short = (await findTool('accounting.dispose_fixed_asset').execute(
      { assetId: ASSET_ID, reason: 'ab' }, ctx
    )) as Record<string, unknown>;
    expect(short.error).toBeDefined();
    const noBox = (await findTool('accounting.dispose_fixed_asset').execute(
      { assetId: ASSET_ID, proceeds: 500, reason: 'بيع الأصل القديم' }, ctx
    )) as Record<string, unknown>;
    expect(noBox.error).toBeDefined();
    expect(vi.mocked(fixedAssetsApi.disposeFixedAsset)).not.toHaveBeenCalled();
  });
});

describe('fixed-asset tools contract', () => {
  it('uses valid permissions with write summaries on mutations', () => {
    const valid = new Set<string>(ALL_PERMISSIONS);
    for (const t of fixedAssetTools) {
      expect(valid.has(t.permission), `${t.name} permission`).toBe(true);
      expect(t.name).toMatch(/^[a-z][a-z0-9]*\.[a-z0-9_]+$/);
    }
    expect(findTool('accounting.list_fixed_assets').permission).toBe('accounting.view');
    const create = findTool('accounting.create_fixed_asset');
    expect(create.permission).toBe('accounting.create');
    expect(typeof create.summarizeArgs).toBe('function');
    const dispose = findTool('accounting.dispose_fixed_asset');
    expect(dispose.permission).toBe('accounting.edit');
    expect(typeof dispose.summarizeArgs).toBe('function');
  });
});
