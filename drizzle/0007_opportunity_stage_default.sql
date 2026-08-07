-- Migration 0007: Change opportunity stage default from 'prospecting' to 'new'
ALTER TABLE IF EXISTS opportunities ALTER COLUMN stage SET DEFAULT 'new';
