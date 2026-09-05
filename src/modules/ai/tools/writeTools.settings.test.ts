import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/api', () => ({
  createProductType: vi.fn(),
  createUnit: vi.fn(),
  createCashBox: vi.fn(),
  createCostCenter: vi.fn(),
}));

vi.mock('@/modules/sales/api', () => ({ salesApi: {} }));
vi.mock('@/modules/purchases/api', () => ({ purchasesApi: {} }));
vi.mock('@/modules/accounting/api', () => ({ accountingApi: {} }));
vi.mock('@/modules/inventory/api', () => ({ inventoryApi: {} }));
vi.mock('@/modules/crm/api', () => ({ crmApi: {} }));
vi.mock('@/modules/hr/api', () => ({ hrApi: {} }));
vi.mock('@/modules/manufacturing/api', () => ({ manufacturingApi: {} }));
vi.mock('@/core/database/adapters', () => ({ getDbAdapter: vi.fn() }));

import { writeTools } from './writeTools';
import {
  createProductType,
  createUnit,
  createCashBox,
  createCostCenter,
} from '@/core/api';
import type { ToolContext } from '../types';

const ctx: ToolContext = {
  companyId: '00000000-0000-0000-0000-00000000000C',
  userId: '00000000-0000-0000-0000-00000000000U',
};

function findTool(name: string) {
  return writeTools.find((t) => t.name === name);
}

/**
 * Regression for the P0 audit findings (2026-09):
 *  1. RBAC escalation — settings write tools were gated by settings.view.
 *  2. Tenant isolation — the four settings create tools dropped companyId,
 *     producing orphan rows (company_id NULL) or silent NOT NULL failures.
 */
describe('settings tools — RBAC + companyId regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('RBAC: write tools use settings.edit, never settings.view', () => {
    const WRITE_SETTINGS_TOOLS = [
      'settings.update_company',
      'settings.update_branch',
      'settings.update_document_sequence',
      'settings.create_product_type',
      'settings.update_product_type',
      'settings.delete_product_type',
      'settings.create_unit',
      'settings.update_unit',
      'settings.delete_unit',
      'settings.create_cash_box',
      'settings.update_cash_box',
      'settings.delete_cash_box',
      'settings.create_cost_center',
      'settings.update_cost_center',
      'settings.delete_cost_center',
      'settings.update_default_account',
      'settings.apply_default_template',
      'settings.generate_theme',
      'settings.create_theme',
      'settings.update_theme',
      'settings.activate_theme',
      'settings.delete_theme',
    ];

    it.each(WRITE_SETTINGS_TOOLS)('%s requires settings.edit', (name) => {
      const tool = findTool(name);
      expect(tool, `tool ${name} must exist`).toBeDefined();
      expect(tool!.permission).toBe('settings.edit');
      expect(tool!.dangerLevel).toBe('write');
    });

    it('the ONLY settings.view tools in writeTools are read-only lists', () => {
      const viewTools = writeTools.filter((t) => t.permission === 'settings.view');
      expect(viewTools.map((t) => t.name).sort()).toEqual(
        ['settings.get_document_sequences', 'settings.list_themes'].sort(),
      );
      for (const tool of viewTools) expect(tool.dangerLevel).toBe('read');
    });
  });

  describe('tenant isolation: create tools pass ctx.companyId', () => {
    it('settings.create_product_type forwards companyId to the API', async () => {
      const tool = findTool('settings.create_product_type');
      vi.mocked(createProductType).mockResolvedValue({ success: true, id: 'pt1' } as never);

      const res = (await tool!.execute({ nameAr: 'منتج نهائي' }, ctx)) as Record<string, unknown>;
      expect(res.created).toBe(true);
      expect(createProductType).toHaveBeenCalledWith(
        expect.objectContaining({ nameAr: 'منتج نهائي', companyId: ctx.companyId }),
      );
    });

    it('settings.create_unit forwards companyId to the API', async () => {
      const tool = findTool('settings.create_unit');
      vi.mocked(createUnit).mockResolvedValue({ success: true, id: 'u1' } as never);

      await tool!.execute({ nameAr: 'كيلوغرام' }, ctx);
      expect(createUnit).toHaveBeenCalledWith(
        expect.objectContaining({ nameAr: 'كيلوغرام', companyId: ctx.companyId }),
      );
    });

    it('settings.create_cash_box forwards companyId to the API', async () => {
      const tool = findTool('settings.create_cash_box');
      vi.mocked(createCashBox).mockResolvedValue({ success: true, id: 'cb1' } as never);

      await tool!.execute({ nameAr: 'خزنة جيب' }, ctx);
      expect(createCashBox).toHaveBeenCalledWith(
        expect.objectContaining({ nameAr: 'خزنة جيب', companyId: ctx.companyId }),
      );
    });

    it('settings.create_cost_center forwards companyId to the API', async () => {
      const tool = findTool('settings.create_cost_center');
      vi.mocked(createCostCenter).mockResolvedValue({ success: true, id: 'cc1' } as never);

      await tool!.execute({ nameAr: 'مركز الرياض' }, ctx);
      expect(createCostCenter).toHaveBeenCalledWith(
        expect.objectContaining({ nameAr: 'مركز الرياض', companyId: ctx.companyId }),
      );
    });

    it('create tools fail honestly when the API rejects', async () => {
      const tool = findTool('settings.create_product_type');
      vi.mocked(createProductType).mockResolvedValue({ success: false, error: 'DB down' } as never);
      const res = (await tool!.execute({ nameAr: 'x' }, ctx)) as Record<string, unknown>;
      expect(res.error).toBe('DB down');
    });
  });
});
