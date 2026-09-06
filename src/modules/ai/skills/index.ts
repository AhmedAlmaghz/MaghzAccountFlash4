import { registerSkills } from './registry';
import { arabicBusinessWriterSkill } from './arabicBusinessWriter';
import { accountingExpertiseSkill } from './accountingExpertise';
import { reportSmartAssistantSkill } from './reportSmartAssistant';
import { businessAnalystSkill } from './businessAnalyst';
import { searchExpertiseSkill } from './searchExpertise';
import { crmAssistantSkill } from './crmAssistant';
import { inventoryUnitsSkill } from './inventoryUnits';
import { regionalFluencySkill } from './regionalFluency';
import { themeDesignerSkill } from './themeDesigner';

/**
 * All built-in skills. Import this module once (side effect) before the chat
 * engine composes the system prompt — the chat engine calls
 * `ensureSkillsRegistered()` in its constructor.
 */

let registered = false;

export function ensureSkillsRegistered(): void {
  if (registered) return;
  registerSkills([
    arabicBusinessWriterSkill,
    accountingExpertiseSkill,
    reportSmartAssistantSkill,
    businessAnalystSkill,
    searchExpertiseSkill,
    crmAssistantSkill,
    inventoryUnitsSkill,
    regionalFluencySkill,
    themeDesignerSkill,
  ]);
  registered = true;
}

export { selectActiveSkills, renderSkillsBlock, getSkill, getAllSkills, clearSkillRegistry } from './registry';
export type { Skill, SkillExample, SkillLoadingMode } from './types';
