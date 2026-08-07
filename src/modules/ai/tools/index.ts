import { registerTools } from './registry';
import { readTools } from './readTools';
import { searchTools } from './searchTools';
import { navigationTools } from './navigationTools';
import { writeTools } from './writeTools';
import { wizardTools } from './wizardTools';
import { reportTools } from './reportTools';
import { detailedReportTools } from './detailedReportTools';

/**
 * Registers every built-in tool. Import this module once (side effect) before
 * the chat engine is used — the AiChatPage and ChatWidget both import it.
 */
let registered = false;

export function ensureToolsRegistered(): void {
  if (registered) return;
  registerTools([...readTools, ...searchTools, ...navigationTools, ...writeTools, ...wizardTools, ...reportTools, ...detailedReportTools]);
  registered = true;
}

export { getTool, getVisibleTools, toLlmTools, clearToolRegistry } from './registry';
export { PAGE_CATALOG } from './navigationTools';
