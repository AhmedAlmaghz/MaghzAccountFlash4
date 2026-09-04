/**
 * WRITE TOOLS — barrel.
 *
 * The former 4,374-line monolith was split by domain in Phase 77
 * (writeTools/<domain>.ts + writeTools/shared.ts) to shrink the
 * merge-conflict surface and keep each accounting area reviewable in
 * isolation. This barrel preserves the public surface unchanged:
 * `import { writeTools } from './writeTools'` keeps working everywhere.
 */
import type { ToolDefinition } from '../types';
import { salesWriteTools } from './writeTools/sales';
import { purchasesWriteTools } from './writeTools/purchases';
import { accountingWriteTools } from './writeTools/accounting';
import { inventoryWriteTools } from './writeTools/inventory';
import { crmWriteTools } from './writeTools/crm';
import { hrWriteTools } from './writeTools/hr';
import { manufacturingWriteTools } from './writeTools/manufacturing';
import { settingsWriteTools } from './writeTools/settings';

export const writeTools: ToolDefinition[] = [
  ...salesWriteTools,
  ...purchasesWriteTools,
  ...accountingWriteTools,
  ...inventoryWriteTools,
  ...crmWriteTools,
  ...hrWriteTools,
  ...manufacturingWriteTools,
  ...settingsWriteTools,
];
