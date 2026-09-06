import { describe, it, expect, beforeAll } from 'vitest';
import { inventoryUnitsSkill } from './inventoryUnits';
import { clearSkillRegistry, registerSkills, selectActiveSkills } from './registry';

describe('inventoryUnits skill', () => {
  beforeAll(() => {
    clearSkillRegistry();
    registerSkills([inventoryUnitsSkill]);
  });

  it('is trigger-loaded with inventory tags', () => {
    expect(inventoryUnitsSkill.loadingMode).toBe('trigger');
    expect(inventoryUnitsSkill.tags).toContain('inventory');
  });

  it('triggers on unit dialect words (كرتون/درزن/شدة)', () => {
    expect(inventoryUnitsSkill.triggers).toContain('كرتون');
    expect(inventoryUnitsSkill.triggers).toContain('درزن');
    const active = selectActiveSkills({ userMessage: 'بيع 5 كراتين تونة', visibleTools: [] });
    expect(active.map((s) => s.id)).toContain('inventory-units');
  });

  it('content covers the three core concepts', () => {
    const c = inventoryUnitsSkill.content;
    expect(c).toContain('search.product_units');
    expect(c).toContain('inventory.create_product_unit');
    expect(c).toContain('factor');
  });

  it('documents snapshot freezing for old documents', () => {
    expect(inventoryUnitsSkill.content).toMatch(/مجمّد|snapshot/i);
  });
});
