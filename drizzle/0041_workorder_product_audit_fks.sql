-- 0041: the two NOT NULL foreign keys that were still missing.
--
-- work_orders.product_id (NOT NULL, no FK): createWorkOrder never verified the
-- product exists and deleteProduct did not probe work orders, so deleting a
-- product that has a work order left the order pointing at nothing - and
-- completing that order would receive finished goods into a product that no
-- longer exists, corrupting the inventory valuation.
--
-- audit_logs.user_id (NOT NULL, no FK): deleting a user would either fail or,
-- on the paths that null it, leave the audit trail unattributed. The audit log
-- must survive the user, so this is SET NULL - the row stays, the actor is
-- lost. (Phase 29 hardened users/roles constraints; this closes the reference.)
--
-- Legacy rows are never deleted: orphans land the constraint NOT VALID.
DO $$
DECLARE
  v_specs text[];
  v_parts text[];
  v_table  text;
  v_column text;
  v_name   text;
  v_ondel  text;
  v_orphans bigint;
  v_exists boolean;
  v_i      int;
BEGIN
  v_specs := ARRAY[
    'work_orders|product_id|products|restrict',
    'boms|product_id|products|restrict',
    'audit_logs|user_id|users|set null'
  ];
  FOR v_i IN 1..array_length(v_specs, 1) LOOP
    v_parts := string_to_array(v_specs[v_i], '|');
    v_table  := v_parts[1];
    v_column := v_parts[2];
    v_name   := v_table || '_' || v_column || '_' || v_parts[3] || '_fk';
    v_ondel  := replace(v_parts[4], ' ', '_');

    IF to_regclass(v_table) IS NULL OR to_regclass(v_parts[3]) IS NULL THEN
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
      v_table, v_column, v_parts[3], v_column
    ) INTO v_orphans;

    IF v_ondel = 'set_null' THEN
      -- A NOT NULL column can never be nulled, so the SET NULL constraint would
      -- simply block every user delete. Relax the column first, then constrain:
      -- the audit row survives, only its actor is lost. (audit_logs.user_id was
      -- declared NOT NULL in 0014; Phase 29 hardened users/roles but left the
      -- audit reference immutable, which made the user undeletable in practice.)
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL', v_table, v_column);
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE SET NULL', v_table, v_name, v_column, v_parts[3]);
    ELSIF v_orphans > 0 THEN
      RAISE NOTICE '0041: %.% has % orphan(s) - adding % NOT VALID (history untouched)', v_table, v_column, v_orphans, v_name;
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE RESTRICT NOT VALID', v_table, v_name, v_column, v_parts[3]);
    ELSE
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE RESTRICT', v_table, v_name, v_column, v_parts[3]);
    END IF;
  END LOOP;
END $$;
