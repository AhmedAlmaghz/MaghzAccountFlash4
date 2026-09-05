import { describe, it, expect, beforeEach } from 'vitest';
import { themeDesignerSkill } from './themeDesigner';
import { registerSkills, getTriggeredSkills, getAllSkills, clearSkillRegistry } from './registry';

beforeEach(() => {
  clearSkillRegistry();
  registerSkills([themeDesignerSkill]);
});

describe('themeDesigner skill', () => {
  it('triggers on theme/appearance vocabulary (ar + en)', () => {
    expect(getTriggeredSkills('غيّر الثيم إلى داكن', []).length).toBe(1);
    expect(getTriggeredSkills('أريد مظهراً أزرق', []).length).toBe(1);
    expect(getTriggeredSkills('switch to dark mode please', []).length).toBe(1);
    expect(getTriggeredSkills('ما رصيد العميل؟', []).length).toBe(0);
  });

  it('documents the theme tool lifecycle', () => {
    expect(themeDesignerSkill.content).toContain('settings.list_themes');
    expect(themeDesignerSkill.content).toContain('settings.generate_theme');
    expect(themeDesignerSkill.content).toContain('emerald-light');
    expect(themeDesignerSkill.examples?.length).toBeGreaterThan(0);
  });

  it('is registered exactly once', () => {
    expect(getAllSkills().filter((s) => s.id === 'theme-designer')).toHaveLength(1);
  });
});
