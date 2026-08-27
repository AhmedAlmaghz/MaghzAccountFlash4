-- Align seeded product-type flags with the manufacturing picker business rule:
--   finished product list  -> appears_in_manufacturing = true AND has_bom = false
--   materials list         -> appears_in_manufacturing = true AND has_bom = true
-- Only touches the well-known seeded type codes; custom types are left alone.
-- Idempotent: re-running is a no-op once values match.

UPDATE product_types
SET appears_in_manufacturing = true, has_bom = false
WHERE code = 'FG';

UPDATE product_types
SET appears_in_manufacturing = true, has_bom = true
WHERE code = 'RAW';
