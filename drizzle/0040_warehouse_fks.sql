-- 0040: warehouse foreign keys — deleting a warehouse used to orphan stock.
--
-- `deleteWarehouse` was a bare DELETE and none of the warehouse_id columns
-- carried a foreign key, so deleting a warehouse that held inventory left:
--   * stock rows pointing at a warehouse that no longer exists
--   * stock_movements rows in the same state
--   * a transfer document whose from/to warehouse no longer resolves
-- Stock is NOT NULL on warehouse_id, so the orphan could not even be nulled
-- out - it was simply unreachable from any screen.
--
-- ON DELETE RESTRICT: a warehouse that holds stock or has movement history is
-- deactivated, never cascaded. Cascading here would silently erase the
-- inventory ledger, which is exactly what Phase 62 refused to do for cash boxes.
--
-- Legacy rows are never deleted: with orphans present the constraint is added
-- NOT VALID, so new and updated rows are enforced and history is left for an
-- operator to clean up.
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
  v_specs := ARRAY[
    'stock|warehouse_id',
    'stock_movements|warehouse_id',
    'stock_adjustments|warehouse_id',
    'warehouse_transfers|from_warehouse_id',
    'warehouse_transfers|to_warehouse_id'
  ];
  FOR v_i IN 1..array_length(v_specs, 1) LOOP
    v_parts := string_to_array(v_specs[v_i], '|');
    v_table  := v_parts[1];
    v_column := v_parts[2];
    v_name   := v_table || '_' || v_column || '_warehouses_fk';

    IF to_regclass(v_table) IS NULL OR to_regclass('warehouses') IS NULL THEN
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
      'SELECT count(*) FROM %I t WHERE t.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM warehouses w WHERE w.id = t.%I)',
      v_table, v_column, v_column
    ) INTO v_orphans;

    IF v_orphans > 0 THEN
      RAISE NOTICE '0040: %.% has % orphan(s) - adding % NOT VALID (history untouched)', v_table, v_column, v_orphans, v_name;
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES warehouses(id) ON DELETE RESTRICT NOT VALID', v_table, v_name, v_column);
    ELSE
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES warehouses(id) ON DELETE RESTRICT', v_table, v_name, v_column);
    END IF;
  END LOOP;
END $$;
