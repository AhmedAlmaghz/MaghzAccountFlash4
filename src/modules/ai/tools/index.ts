import { getAllTools, registerTools } from './registry';
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
import { entityTools } from './entityTools';
import { jevTools } from '../jev/jevTools';

/**
 * Registers every built-in tool. Import this module once (side effect) before
 * the chat engine is used — the AiChatPage and ChatWidget both import it.
 */
let registered = false;

export function ensureToolsRegistered(): void {
  // The flag alone is not enough: `clearToolRegistry()` (tests, HMR) empties
  // the Map while the flag stays true, so a later ensure() would be a no-op
  // and the agent would run with ZERO tools.
  if (registered && getAllTools().length > 0) return;
  registerTools([...readTools, ...searchTools, ...entityTools, ...navigationTools, ...writeTools, ...hrTools, ...wizardTools, ...reportTools, ...detailedReportTools, ...diagnosticTools, ...batchTools, ...directionTools, ...posTools, ...fixedAssetTools, ...taxTools, ...memoryTools, ...jevTools]);
  registered = true;
}

export { getTool, getVisibleTools, toLlmTools, clearToolRegistry } from './registry';
export { PAGE_CATALOG } from './navigationTools';
