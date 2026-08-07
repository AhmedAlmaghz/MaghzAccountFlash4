import type { Skill } from './types';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerSkill,
  registerSkills,
  clearSkillRegistry,
  getSkill,
  getAllSkills,
  getAlwaysOnSkills,
  getTriggeredSkills,
  selectActiveSkills,
  renderSkillsBlock,
} from './registry';
import type { ToolDefinition } from '../types';

// ─── Test fixtures ─────────────────────────────────────────────────────
const makeTool = (name: string, permission: string = 'core.view'): ToolDefinition => ({
  name, labelAr: name, descriptionAr: name, permission,
  dangerLevel: 'read', parameters: { type: 'object', properties: {} },
  execute: async () => ({}),
});

const ALWAYS_SKILL: Skill = {
  id: 'always',
  nameAr: 'دائماً',
  descriptionAr: 'مهارة تُحمَّل دائماً',
  loadingMode: 'always',
  priority: 50,
  content: 'محتوى دائماً',
};

const TRIGGER_SKILL: Skill = {
  id: 'trigger-finance',
  nameAr: 'محاسبة',
  descriptionAr: 'تُحمَّل عند ذكر كلمة محاسبة',
  loadingMode: 'trigger',
  triggers: ['محاسبة', 'accounting'],
  priority: 60,
  content: 'محتوى محاسبي',
};

const TRIGGER_NO_MATCH: Skill = {
  id: 'trigger-inventory',
  nameAr: 'مخزون',
  descriptionAr: 'تُحمَّل عند ذكر مخزون',
  loadingMode: 'trigger',
  triggers: ['مخزون', 'inventory'],
  content: 'محتوى مخزون',
};

const MANUAL_SKILL: Skill = {
  id: 'manual-extra',
  nameAr: 'يدوي',
  descriptionAr: 'تُفعَّل يدوياً',
  loadingMode: 'manual',
  content: 'محتوى يدوي',
};

const CONDITIONAL_SKILL: Skill = {
  id: 'conditional',
  nameAr: 'مشروط',
  descriptionAr: 'يُفعَّل فقط عند وجود sales.get_invoices',
  loadingMode: 'trigger',
  triggers: ['تقرير'],
  content: 'محتوى مشروط',
  appliesWithTools: (tools) => tools.some((t) => t.name === 'sales.get_invoices'),
};

describe('skills/registry', () => {
  beforeEach(() => {
    clearSkillRegistry();
  });

  it('registers a single skill and retrieves it', () => {
    registerSkill(ALWAYS_SKILL);
    expect(getSkill('always')).toBe(ALWAYS_SKILL);
    expect(getSkill('missing')).toBeUndefined();
  });

  it('registerSkills accepts arrays and is idempotent', () => {
    registerSkills([ALWAYS_SKILL, TRIGGER_SKILL]);
    registerSkills([ALWAYS_SKILL]); // re-register same id → no-op
    expect(getAllSkills().length).toBe(2);
  });

  it('returns only always-on skills from getAlwaysOnSkills', () => {
    registerSkills([ALWAYS_SKILL, TRIGGER_SKILL, MANUAL_SKILL]);
    const always = getAlwaysOnSkills();
    expect(always.map((s) => s.id)).toEqual(['always']);
  });

  it('returns trigger skills whose keywords match the user message', () => {
    registerSkills([TRIGGER_SKILL, TRIGGER_NO_MATCH, ALWAYS_SKILL]);
    const tools: ToolDefinition[] = [];
    const triggered = getTriggeredSkills('أعطني تقرير محاسبة', tools);
    expect(triggered.map((s) => s.id)).toEqual(['trigger-finance']);
  });

  it('is case-insensitive on trigger keywords', () => {
    registerSkills([TRIGGER_SKILL]);
    const tools: ToolDefinition[] = [];
    expect(getTriggeredSkills('ACCOUNTING report', tools).length).toBe(1);
    expect(getTriggeredSkills('محاسبة شهرية', tools).length).toBe(1);
  });

  it('skips trigger skills when appliesWithTools returns false', () => {
    registerSkills([CONDITIONAL_SKILL]);
    const toolsEmpty: ToolDefinition[] = [];
    const toolsFull = [makeTool('sales.get_invoices')];

    expect(getTriggeredSkills('تقرير', toolsEmpty).length).toBe(0);
    expect(getTriggeredSkills('تقرير', toolsFull).length).toBe(1);
  });

  it('selectActiveSkills composes always + trigger + manual, deduped', () => {
    registerSkills([ALWAYS_SKILL, TRIGGER_SKILL, TRIGGER_NO_MATCH, MANUAL_SKILL]);
    const tools: ToolDefinition[] = [];
    const active = selectActiveSkills({
      userMessage: 'تقرير محاسبة',
      visibleTools: tools,
      manualIds: ['manual-extra'],
    });
    const ids = active.map((s) => s.id).sort();
    expect(ids).toEqual(['always', 'manual-extra', 'trigger-finance']);
  });

  it('selectActiveSkills sorts by priority descending', () => {
    registerSkills([ALWAYS_SKILL, TRIGGER_SKILL]); // trigger has higher priority
    const tools: ToolDefinition[] = [];
    const active = selectActiveSkills({ userMessage: 'محاسبة', visibleTools: tools });
    expect(active.map((s) => s.id)).toEqual(['trigger-finance', 'always']);
  });

  it('renderSkillsBlock returns empty string for no skills', () => {
    expect(renderSkillsBlock([])).toBe('');
  });

  it('renderSkillsBlock includes name, description, content, examples', () => {
    const skillWithExamples: Skill = {
      id: 'demo', nameAr: 'تجريبي', descriptionAr: 'مهارة للاختبار',
      loadingMode: 'always', content: 'محتوى',
      examples: [{ user: 'سؤال', assistant: 'جواب' }],
    };
    const block = renderSkillsBlock([skillWithExamples]);
    expect(block).toContain('تجريبي');
    expect(block).toContain('محتوى');
    expect(block).toContain('سؤال');
    expect(block).toContain('جواب');
  });

  it('clearSkillRegistry empties the registry', () => {
    registerSkills([ALWAYS_SKILL, TRIGGER_SKILL]);
    expect(getAllSkills().length).toBe(2);
    clearSkillRegistry();
    expect(getAllSkills().length).toBe(0);
  });
});
