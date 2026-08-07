-- Migration 0002: Add missing BOM/Work Order columns
-- Adds total_cost, notes to boms; total_cost to bom_lines; actual_unit_cost to work_order_consumptions

-- Boms: total_cost + notes
ALTER TABLE boms ADD COLUMN IF NOT EXISTS total_cost numeric(18, 4) DEFAULT '0';
ALTER TABLE boms ADD COLUMN IF NOT EXISTS notes text;

-- Bom lines: total_cost
ALTER TABLE bom_lines ADD COLUMN IF NOT EXISTS total_cost numeric(18, 4) DEFAULT '0';

-- Work order consumptions: actual_unit_cost
ALTER TABLE work_order_consumptions ADD COLUMN IF NOT EXISTS actual_unit_cost numeric(18, 4) DEFAULT '0';
