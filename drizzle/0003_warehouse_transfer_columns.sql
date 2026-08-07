-- Migration 0003: Add date/reference columns to warehouse_transfers
-- Backfills the flat StockTransfer type into the normalized schema

ALTER TABLE warehouse_transfers ADD COLUMN IF NOT EXISTS date timestamp with time zone DEFAULT now();
ALTER TABLE warehouse_transfers ADD COLUMN IF NOT EXISTS reference varchar(100);
