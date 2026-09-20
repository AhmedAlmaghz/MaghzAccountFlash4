import { registerTools } from './registry';
import { readTools } from './readTools';
import { searchTools } from './searchTools';
import { navigationTools } from './navigationTools';
import { writeTools } from './writeTools';
import { hrTools } from './hrTools';
import { wizardTools } from './wizardTools';
import { reportTools } from './reportTools';
import { detailedReportTools } from './detailedReportTools';
import { diagnosticTools } from './diagnosticTools';
import { batchTools } from './batchTools';
import { directionTools } from './directionTools';
import { posTools } from './posTools';
import { fixedAssetTools } from './fixedAssetTools';
import { taxTools } from './taxTools';
import { memoryTools } from './memoryTools';

/**
 * Registers every built-in tool. Import this module once (side effect) before
 * the chat engine is used — the AiChatPage and ChatWidget both import it.
 */
let registered = false;

export function ensureToolsRegistered(): void {
  if (registered) return;
  registerTools([...readTools, ...searchTools, ...navigationTools, ...writeTools, ...hrTools, ...wizardTools, ...reportTools, ...detailedReportTools, ...diagnosticTools, ...batchTools, ...directionTools, ...posTools, ...fixedAssetTools, ...taxTools, ...memoryTools]);
  registered = true;
}

export { getTool, getVisibleTools, toLlmTools, clearToolRegistry } from './registry';
export { PAGE_CATALOG } from './navigationTools';
