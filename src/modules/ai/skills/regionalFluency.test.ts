import { describe, it, expect, beforeAll } from 'vitest';
import { regionalFluencySkill } from './regionalFluency';
import { registerSkills, getAllSkills, clearSkillRegistry } from './registry';
import { ensureSkillsRegistered } from './index';

/**
 * The regional-fluency skill contract: always-on, registered with the others,
 * and its content carries the dialect map + regional VAT knowledge the
 * accountant-agent needs to understand local phrasing.
 */
describe('regionalFluency skill', () => {
  beforeAll(() => {
    clearSkillRegistry();
    registerSkills([regionalFluencySkill]);
  });

  it('is always-on with regional tags', () => {
    expect(regionalFluencySkill.loadingMode).toBe('always');
    expect(regionalFluencySkill.tags).toContain('dialect');
  });

  it('content covers the five major dialect regions', () => {
    const c = regionalFluencySkill.content;
    for (const region of ['اليمن', 'الخليج', 'مصر', 'الشام', 'مغربي']) {
      expect(c).toContain(region);
    }
  });

  it('maps the signature Yemeni/Gulf/Egyptian phrases', () => {
    const c = regionalFluencySkill.content;
    expect(c).toContain('محفظة جيب');
    expect(c).toContain('الصراف');
    expect(c).toContain('كسر');
    expect(c).toContain('دستة');
  });

  it('documents regional VAT norms but defers to company settings', () => {
    const c = regionalFluencySkill.content;
    expect(c).toContain('15%');
    expect(c).toContain('5%');
    expect(c).toContain('14%');
    expect(c).toContain('طبّق إعداد الشركة الفعلي');
  });

  it('requires confirming hijri-converted dates on critical documents', () => {
    expect(regionalFluencySkill.content).toContain('اطلب تأكيده');
  });

  it('registers through the standard skills bootstrap', () => {
    clearSkillRegistry();
    ensureSkillsRegistered();
    const all = getAllSkills();
    expect(all.some((s) => s.id === 'regional-fluency')).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(7);
  });
});
