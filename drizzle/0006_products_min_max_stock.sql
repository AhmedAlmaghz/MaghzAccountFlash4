-- Migration 0006: Add product-level stock threshold columns + image

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'image'
  ) THEN
    ALTER TABLE products ADD COLUMN "image" text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'min_stock'
  ) THEN
    ALTER TABLE products ADD COLUMN "min_stock" numeric(18, 4);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'max_stock'
  ) THEN
    ALTER TABLE products ADD COLUMN "max_stock" numeric(18, 4);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'reorder_point'
  ) THEN
    ALTER TABLE products ADD COLUMN "reorder_point" numeric(18, 4);
  END IF;
END $$;
