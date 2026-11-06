-- Additive, idempotent migration: products carry the date their opening
-- stock was posted. Mirrors customers/suppliers/accounts/employees
-- (opening_date, added by the historical 0013 migration) so the opening
-- journal entry, the FIFO layer and every statement/aging report can be
-- ordered by a user-supplied date instead of the entry timestamp.
--
-- The column is nullable on purpose:
--   * NULL = no opening stock was ever posted for this product.
--   * a date = postProductStockOpening stamped it atomically with the JE.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "opening_date" date;
