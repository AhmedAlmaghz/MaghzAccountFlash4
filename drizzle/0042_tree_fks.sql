-- 0042: self-referencing tree keys, plus the documented FK-free columns.
--
-- accounts.parent_id / product_categories.parent_id / cost_centers.parent_id
-- are self-referencing hierarchy keys with no foreign key. Deleting a parent
-- left the children pointing at a row that no longer exists, and the chart of
-- accounts then rendered half a tree. ON DELETE CASCADE is the correct semantic
-- here - unlike a financial reference, a subtree has no meaning without its
-- root, and `deleteAccount` separately refuses to delete an account that has
-- journal entries.
--
-- Deliberately still FK-free (documented so the next census does not read it as
-- an oversight):
--   * cash_boxes.branch_id, warehouses.branch_id, products.category_id,
--     vat_settings.account_id - all nullable classification, never a financial
--     reference; no branch-deletion path exists in the app.
--   * receipt_vouchers.cash_box_id / payment_vouchers.cash_box_id - Phase 62
--     decision: a used cash box must not block deletion, and the voucher keeps
--     pointing at the box id for the audit trail.
--
-- Legacy orphans land NOT VALID.
DO $$
DECLARE
  v_specs text[];
  v_parts text[];
  v_table  text;
  v_column text;
  v_name   text;
  v_orphans bigint;
  v_exists boolean;
  v_i      int;
BEGIN
  v_specs := ARRAY['accounts', 'product_categories', 'cost_centers'];
  FOR v_i IN 1..array_length(v_specs, 1) LOOP
    v_table  := v_specs[v_i];
    v_column := 'parent_id';
    v_name   := v_table || '_' || v_column || '_self_fk';

    IF to_regclass(v_table) IS NULL THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = v_table AND column_name = v_column
    ) THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = v_table::regclass AND contype = 'f' AND conname = v_name
    ) INTO v_exists;
    IF v_exists THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM %I t WHERE t.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I p WHERE p.id = t.%I)',
      v_table, v_column, v_table, v_column
    ) INTO v_orphans;

    IF v_orphans > 0 THEN
      RAISE NOTICE '0042: %.% has % orphan(s) - adding % NOT VALID (history untouched)', v_table, v_column, v_orphans, v_name;
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE CASCADE NOT VALID', v_table, v_name, v_column, v_table);
    ELSE
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE CASCADE', v_table, v_name, v_column, v_table);
    END IF;
  END LOOP;
END $$;
