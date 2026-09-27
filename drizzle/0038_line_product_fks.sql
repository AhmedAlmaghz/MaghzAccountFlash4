-- 0038: FK products on the two invoice-line tables that were missing them.
--
-- Every other document-line table already declares the constraint
-- (quotation_lines, sales_return_lines, purchase_order_lines,
-- purchase_return_lines -> products(id) ON DELETE RESTRICT). These two did not:
-- sales_invoice_lines.product_id and purchase_invoice_lines.product_id had NO
-- foreign key at all, so a deleted product left orphan lines behind on posted
-- revenue documents and on the purchase side.
--
-- ON DELETE is CASCADE by owner decision. Note the consequence, which is why
-- inventoryApi.deleteProduct refuses to delete a product that any document still
-- references: with CASCADE alone, deleting a product would strip lines out of
-- posted invoices while their headers kept the old totals.
--
-- Legacy rows are never deleted here. If orphans exist the constraint is added
-- NOT VALID: new and updated rows are checked from now on, history is left for
-- an operator to clean up, and the migration still applies.
DO $$
DECLARE
  v_name    text;
  v_table   text;
  v_orphans bigint;
  v_exists  boolean;
  v_i       int;
  v_tables  text[] := ARRAY['sales_invoice_lines', 'purchase_invoice_lines'];
  v_names   text[] := ARRAY['sales_invoice_lines_product_id_products_id_fk', 'purchase_invoice_lines_product_id_products_id_fk'];
BEGIN
  FOR v_i IN 1..array_length(v_tables, 1) LOOP
    v_table := v_tables[v_i];
    v_name  := v_names[v_i];

    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = v_table::regclass AND contype = 'f' AND conname = v_name
    ) INTO v_exists;
    IF v_exists THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM %I l WHERE l.product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = l.product_id)',
      v_table
    ) INTO v_orphans;

    IF v_orphans > 0 THEN
      RAISE NOTICE '0038: % has % orphan line(s) - adding % NOT VALID (history untouched)', v_table, v_orphans, v_name;
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE NOT VALID', v_table, v_name);
    ELSE
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE', v_table, v_name);
    END IF;
  END LOOP;
END $$;
