-- 0039: the foreign keys the party links and audit columns never had.
--
-- `customers` and `suppliers` had NO incoming foreign key anywhere in the
-- schema, so deleting a customer or supplier succeeded even with invoices,
-- receipts and returns pointing at it: the document kept a dangling party id,
-- and the statement / AR-AP aging / balance for that party became
-- unreachable. `deleteCustomer` even carries a "Cannot delete customer with
-- existing invoices ... Deactivate instead" message that could never fire,
-- because there was no constraint to violate.
--
-- ON DELETE RESTRICT is the only defensible direction for a party link: a
-- customer with documents must be deactivated, never cascaded away. This also
-- makes the existing friendly-error branch real instead of decorative.
--
-- Audit columns (created_by / updated_by / approved_by) get ON DELETE SET NULL,
-- matching the design already stated in the docs: deleting a user must not
-- delete their documents, it only clears the attribution.
--
-- Legacy rows are never deleted here: if orphans exist the constraint is added
-- NOT VALID, so new and updated rows are enforced from now on.
DO $$
DECLARE
  v_spec   text[];
  v_parts  text[];
  v_table  text;
  v_column text;
  v_target text;
  v_name   text;
  v_ondel  text;
  v_orphans bigint;
  v_exists boolean;
  v_i      int;
  v_specs  text[];
  v_cols   text[];
BEGIN
  v_specs := ARRAY[
    -- party links (RESTRICT: never delete a party that owns documents)
    -- format: table|column|target|on-delete   (a pipe, because the table
    -- reference itself contains a dot)
    'sales_invoices|customer_id|customers|restrict',
    'purchase_invoices|supplier_id|suppliers|restrict',
    'receipt_vouchers|customer_id|customers|restrict',
    'payment_vouchers|supplier_id|suppliers|restrict',
    'sales_returns|customer_id|customers|restrict',
    'purchase_returns|supplier_id|suppliers|restrict',
    'quotations|customer_id|customers|restrict',
    'purchase_orders|supplier_id|suppliers|restrict',
    'pos_payments|customer_id|customers|restrict',
    'leads|customer_id|customers|restrict',
    'opportunities|customer_id|customers|restrict',
    'tasks|customer_id|customers|restrict',
    'activities|customer_id|customers|restrict',
    'journal_entries|account_id|accounts|restrict',
    'boms|product_id|products|restrict',
    'stock|product_id|products|restrict',
    'stock_movements|product_id|products|restrict',
    'stock_adjustments|product_id|products|restrict',
    'warehouse_transfer_lines|product_id|products|restrict',
    'employees|department_id|departments|set null',
    'leaves|employee_id|employees|restrict',
    'attendance|employee_id|employees|restrict',
    'end_of_service|employee_id|employees|restrict',
    'payroll_lines|employee_id|employees|restrict',
    'work_order_consumptions|material_id|products|restrict',
    'bom_lines|material_id|products|restrict'
  ];
  FOR v_i IN 1..array_length(v_specs, 1) LOOP
    v_parts := string_to_array(v_specs[v_i], '|');
    v_table  := v_parts[1];
    v_column := v_parts[2];
    v_target := v_parts[3];
    v_ondel  := replace(v_parts[4], ' ', '_');
    v_name   := v_table || '_' || v_column || '_' || v_target || '_fk';

    -- the table and the column must both exist (a retired table is skipped)
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
      v_table, v_column, v_target, v_column
    ) INTO v_orphans;

    IF v_ondel = 'restrict' THEN
      IF v_orphans > 0 THEN
        RAISE NOTICE '0039: %.% has % orphan(s) - adding % NOT VALID (history untouched)', v_table, v_column, v_orphans, v_name;
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE RESTRICT NOT VALID', v_table, v_name, v_column, v_target);
      ELSE
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE RESTRICT', v_table, v_name, v_column, v_target);
      END IF;
    ELSE
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE SET NULL', v_table, v_name, v_column, v_target);
    END IF;
  END LOOP;

  -- Audit attribution across every table that has one: SET NULL, so deleting a
  -- user never removes documents, it only clears who touched them.
  IF to_regclass('users') IS NOT NULL THEN
    FOR v_table, v_column IN (
      SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        AND c.column_name IN ('created_by', 'updated_by', 'approved_by')
      ORDER BY c.table_name, c.column_name
    ) LOOP
      v_name := v_table || '_' || v_column || '_users_fk';
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = v_table::regclass AND contype = 'f' AND conname = v_name
      ) INTO v_exists;
      IF v_exists THEN
        CONTINUE;
      END IF;
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users(id) ON DELETE SET NULL', v_table, v_name, v_column);
    END LOOP;
  END IF;
END $$;
