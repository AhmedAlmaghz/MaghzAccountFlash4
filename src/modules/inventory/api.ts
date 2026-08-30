import { getDbAdapter } from '@/core/database/adapters';
import { mapRows } from '@/core/utils/mapPgRow';
import { safeUserId } from '@/core/utils/userIdValidator';
import { z } from 'zod';
import { validateInput, idCompanySchema, companyIdSchema, uuidSchema, createProductSchema, createWarehouseSchema, createStockTransferSchema, createStockAdjustmentSchema, createInventoryTransactionSchema, createProductCategorySchema } from '@/core/utils/validation';
import { clampPageArgs, paginatedResult, type PaginatedQueryResult } from '@/core/utils/pagination';
import type { Product, Warehouse, Stock, StockItem, StockTransfer, InventoryTransaction, StockAdjustment, ProductCategory } from './types';

export const inventoryApi = {
  // ─── Products ─────────────────────────────────────────────────────────────
  async getProducts(companyId: string, ownedByUserId?: string): Promise<{ success: boolean; data?: Product[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.getProducts(companyId);
      let rows = mapRows<Product>(result.data);
      if (ownedByUserId) {
        rows = rows.filter((r) => (r as unknown as { createdBy?: string }).createdBy === ownedByUserId || !(r as unknown as { createdBy?: string }).createdBy);
      }
      return { success: result.success, data: rows, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getProductsPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { search?: string; isActive?: boolean; productTypeId?: string }
  ): Promise<PaginatedQueryResult<Product>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      const adapter = await getDbAdapter();

      const conditions: string[] = ['p.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.isActive !== undefined) {
        params.push(filters.isActive);
        conditions.push(`p.is_active = $${params.length}`);
      }
      if (filters?.productTypeId) {
        params.push(filters.productTypeId);
        conditions.push(`p.product_type_id = $${params.length}`);
      }
      if (filters?.search) {
        params.push(`%${filters.search}%`);
        conditions.push(`(p.name_ar ILIKE $${params.length} OR p.name_en ILIKE $${params.length} OR p.code ILIKE $${params.length} OR p.barcode ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM products p WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      params.push(ps);
      params.push(offset);
      const limitIdx = params.length - 1;
      const offsetIdx = params.length;

      const dataResult = await adapter.query(
        `SELECT p.*, pt.name_ar AS product_type_name,
                u.name_ar AS unit_name, u.code AS unit_code,
                COALESCE(
                  (SELECT json_agg(ppc.category_id)
                   FROM product_product_categories ppc
                   WHERE ppc.product_id = p.id), '[]'::json
                ) AS category_ids,
                COALESCE(
                  (SELECT json_agg(jsonb_build_object('id', pc.id, 'name', pc.name) ORDER BY pc.name)
                   FROM product_product_categories ppc
                   JOIN product_categories pc ON pc.id = ppc.category_id
                   WHERE ppc.product_id = p.id), '[]'::json
                ) AS category_names
           FROM products p
            LEFT JOIN product_types pt ON pt.id = p.product_type_id
            LEFT JOIN units u ON (u.name_ar = p.unit OR u.code = p.unit) AND u.company_id = p.company_id
          WHERE ${where}
          ORDER BY p.code, p.name_ar
          LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = mapRows<Product>(dataResult.rows || []);
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createProduct(data: Omit<Product, 'id'>, _createdBy?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createProductSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      const adapter = await getDbAdapter();
      const payload = { ...data, createdBy: _createdBy ?? data.createdBy, updatedBy: _createdBy ?? data.updatedBy };
      const created = await adapter.createProduct(payload);
      if (!created.success || !created.id) return { success: false, error: created.error };
      const productId = String(created.id);
      // Opening stock: movement + stock row + balanced JE (Dr Inventory / Cr Opening Equity)
      const openingQty = Number(data.openingStockQty) || 0;
      if (productId && openingQty > 0 && !data.openingStockPosted) {
        const { postProductStockOpening } = await import('@/core/utils/openingBalance');
        await postProductStockOpening(data.companyId, {
          productId,
          productName: `${data.code} - ${data.nameAr}`,
          quantity: openingQty,
          warehouseId: data.openingWarehouseId || null,
          costPrice: Number(data.costPrice) || 0,
        });
      }
      return { success: true, id: productId };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateProduct(id: string, companyId: string, _updatedBy?: string, data: Partial<Product> = {}): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      if (data.categoryIds !== undefined) {
        await adapter.query('DELETE FROM product_product_categories WHERE product_id = $1 AND $2 = (SELECT company_id FROM products WHERE id = $1)', [id, companyId]);
        if (data.categoryIds.length > 0) {
          const catValues = data.categoryIds.map((_: string, i: number) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ');
          const catParams = data.categoryIds.flatMap((cid: string) => [id, cid]);
          await adapter.query(
            `INSERT INTO product_product_categories (product_id, category_id) VALUES ${catValues} ON CONFLICT DO NOTHING`,
            catParams
          );
        }
      }
      return adapter.query(
        `UPDATE products SET name_ar = $1, name_en = $2, code = $3, barcode = $4, sku = $5, unit = $6, cost_price = $7, sale_price = $8, is_active = $9, image = $10, min_stock = $11, max_stock = $12, reorder_point = $13, category_id = $14, product_type_id = $15, updated_by = $16, updated_at = NOW() WHERE id = $17 AND company_id = $18`,
        [data.nameAr, data.nameEn, data.code, data.barcode, data.sku, data.unit, data.costPrice, data.salePrice, data.isActive, data.image, data.minStock, data.maxStock, data.reorderPoint, data.categoryId ?? null, data.productTypeId ?? null, _updatedBy ?? data.updatedBy ?? null, id, companyId]
      );
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteProduct(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      return adapter.query('DELETE FROM products WHERE id = $1 AND company_id = $2', [id, companyId]);
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Warehouses ───────────────────────────────────────────────────────────
  async getWarehouses(companyId: string): Promise<{ success: boolean; data?: Warehouse[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        'SELECT * FROM warehouses WHERE company_id = $1 AND is_active = true ORDER BY name',
        [companyId]
      );
      if (result.success) {
        return { success: true, data: mapRows<Warehouse>(result.rows) };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createWarehouse(data: Omit<Warehouse, 'id'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createWarehouseSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `INSERT INTO warehouses (company_id, name, code, branch_id, is_active, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [data.companyId, data.name, data.code ?? null, data.branchId ?? null, data.isActive ?? true, safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) {
        return { success: true, id: result.rows[0].id };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateWarehouse(id: string, companyId: string, data: Partial<Warehouse>, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (data.name !== undefined) { fields.push(`name = $${idx++}`); params.push(data.name); }
      if (data.code !== undefined) { fields.push(`code = $${idx++}`); params.push(data.code); }
      if (data.branchId !== undefined) { fields.push(`branch_id = $${idx++}`); params.push(data.branchId); }
      if (data.isActive !== undefined) { fields.push(`is_active = $${idx++}`); params.push(data.isActive); }
      fields.push(`updated_by = $${idx++}`);
      params.push(safeUserId(_userId));
      fields.push('updated_at = NOW()');
      if (fields.length === 0) return { success: true };
      params.push(id);
      params.push(companyId);
      return adapter.query(
        `UPDATE warehouses SET ${fields.join(', ')} WHERE id = $${idx++} AND company_id = $${idx}`,
        params
      );
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteWarehouse(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      return adapter.query('DELETE FROM warehouses WHERE id = $1 AND company_id = $2', [id, companyId]);
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Stock ────────────────────────────────────────────────────────────────
  async getStock(companyId: string): Promise<{ success: boolean; data?: Stock[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        'SELECT * FROM stock WHERE company_id = $1',
        [companyId]
      );
      if (result.success) {
        return { success: true, data: mapRows<Stock>(result.rows) };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getProductStock(productId: string, companyId: string, warehouseId?: string): Promise<{ success: boolean; data?: Stock[]; error?: string }> {
    try {
      const idValidation = validateInput(z.object({ productId: uuidSchema, companyId: companyIdSchema }), { productId, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      let sql = 'SELECT * FROM stock WHERE product_id = $1 AND company_id = $2';
      const params: (string | number)[] = [productId, companyId];
      if (warehouseId) {
        sql += ' AND warehouse_id = $3';
        params.push(warehouseId);
      }
      const result = await adapter.query(sql, params);
      if (result.success) {
        return { success: true, data: mapRows<Stock>(result.rows) };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Stock Detailed ───────────────────────────────────────────────────────
  async getStockDetailed(companyId: string): Promise<{ success: boolean; data?: StockItem[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT s.*, p.name_ar as product_name, p.code as product_code, p.unit, p.cost_price, w.name as warehouse_name
        FROM stock s
        JOIN products p ON p.id = s.product_id
        JOIN warehouses w ON w.id = s.warehouse_id
        WHERE s.company_id = $1`,
        [companyId]
      );
      if (result.success) {
        return { success: true, data: mapRows<StockItem>(result.rows) };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Stock Transfer (warehouse_transfers header + warehouse_transfer_lines) ──
  async createStockTransfer(
    data: Omit<StockTransfer, 'id'> & { lines?: Array<{ productId: string; quantity: number }> },
    _userId?: string
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createStockTransferSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      const adapter = await getDbAdapter();
      const headerResult = await adapter.query(
        `INSERT INTO warehouse_transfers (company_id, from_warehouse_id, to_warehouse_id, date, transfer_number, reference, notes, status, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [data.companyId, data.fromWarehouseId, data.toWarehouseId, data.date, data.transferNumber ?? null, data.reference ?? null, data.notes ?? null, data.status ?? 'draft', safeUserId(_userId), safeUserId(_userId)]
      );
      if (!headerResult.success || !headerResult.rows?.[0]) {
        return { success: false, error: headerResult.error || 'Failed to create transfer header' };
      }
      const transferId = String(headerResult.rows[0].id);
      const lines = data.lines && data.lines.length > 0
        ? data.lines
        : (data.productId && data.quantity ? [{ productId: data.productId, quantity: data.quantity }] : []);
      if (lines.length === 0) {
        return { success: false, error: 'يجب إضافة منتج واحد على الأقل' };
      }
      const placeholders = lines.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ');
      const params: unknown[] = [transferId, ...lines.flatMap(l => [l.productId, l.quantity])];
      const lineResult = await adapter.query(
        `INSERT INTO warehouse_transfer_lines (transfer_id, product_id, quantity) VALUES ${placeholders}`,
        params
      );
      if (!lineResult.success) {
        return { success: false, error: lineResult.error };
      }
      return { success: true, id: transferId };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getStockTransfers(companyId: string): Promise<{ success: boolean; data?: StockTransfer[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT wt.id, wt.company_id, wt.from_warehouse_id, wt.to_warehouse_id, wt.date, wt.transfer_number,
                wt.reference, wt.status, wt.notes, wt.created_at,
                fw.name AS from_warehouse_name, tw.name AS to_warehouse_name,
                COUNT(wl.id)::int AS lines_count,
                COALESCE(SUM(wl.quantity), 0) AS total_quantity
         FROM warehouse_transfers wt
         LEFT JOIN warehouses fw ON fw.id = wt.from_warehouse_id
         LEFT JOIN warehouses tw ON tw.id = wt.to_warehouse_id
         LEFT JOIN warehouse_transfer_lines wl ON wl.transfer_id = wt.id
         WHERE wt.company_id = $1
         GROUP BY wt.id, fw.name, tw.name
         ORDER BY wt.created_at DESC`,
        [companyId]
      );
      if (result.success) {
        return { success: true, data: mapRows<StockTransfer>(result.rows) };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getStockTransferLines(transferId: string, companyId: string): Promise<{ success: boolean; data?: Array<{ id: string; productId: string; productName?: string; quantity: number }>; error?: string }> {
    try {
      const idValidation = validateInput(z.object({ id: uuidSchema, companyId: companyIdSchema }), { id: transferId, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT wl.id, wl.product_id, wl.quantity, p.name_ar AS product_name, p.code AS product_code
           FROM warehouse_transfer_lines wl
           LEFT JOIN products p ON p.id = wl.product_id
          WHERE wl.transfer_id = $1
            AND EXISTS (SELECT 1 FROM warehouse_transfers wt WHERE wt.id = wl.transfer_id AND wt.company_id = $2)
          ORDER BY p.name_ar`,
        [transferId, companyId]
      );
      if (result.success) {
        return { success: true, data: mapRows<{ id: string; productId: string; productName?: string; quantity: number }>(result.rows) };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteStockTransfer(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const del = await adapter.query(
        `DELETE FROM warehouse_transfer_lines WHERE transfer_id IN (SELECT id FROM warehouse_transfers WHERE id = $1 AND company_id = $2)`,
        [id, companyId]
      );
      if (!del.success) return { success: false, error: del.error };
      return adapter.query(
        `DELETE FROM warehouse_transfers WHERE id = $1 AND company_id = $2`,
        [id, companyId]
      );
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async completeStockTransfer(id: string, companyId: string, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const hdr = await adapter.query(
        `SELECT from_warehouse_id, to_warehouse_id FROM warehouse_transfers WHERE id = $1 AND company_id = $2 AND status = 'draft'`,
        [id, companyId]
      );
      if (!hdr.success || !hdr.rows?.[0]) return { success: false, error: 'Transfer not found or not in draft status' };
      const fromId = String((hdr.rows[0] as Record<string, unknown>).from_warehouse_id);
      const toId = String((hdr.rows[0] as Record<string, unknown>).to_warehouse_id);
      const tx: Array<{ sql: string; params?: unknown[] }> = [];
      // Ensure destination stock rows exist
      tx.push({
        sql: `INSERT INTO stock (company_id, product_id, warehouse_id, quantity)
              SELECT $2::uuid, wtl.product_id, $3::uuid, 0
                FROM warehouse_transfer_lines wtl
                LEFT JOIN stock s ON s.company_id = $2::uuid AND s.product_id = wtl.product_id AND s.warehouse_id = $3::uuid
               WHERE wtl.transfer_id = $1::uuid AND s.id IS NULL
               GROUP BY wtl.product_id`,
        params: [id, companyId, toId],
      });
      // Movements: out from source, in to destination
      tx.push({
        sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_at)
              SELECT $2::uuid, wtl.product_id, $3::uuid, 'transfer', wtl.quantity, $1, 'تحويل صادر', NOW()
                FROM warehouse_transfer_lines wtl WHERE wtl.transfer_id = $1::uuid`,
        params: [id, companyId, fromId],
      });
      tx.push({
        sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_at)
              SELECT $2::uuid, wtl.product_id, $4::uuid, 'transfer', wtl.quantity, $1, 'تحويل وارد', NOW()
                FROM warehouse_transfer_lines wtl WHERE wtl.transfer_id = $1::uuid`,
        params: [id, companyId, fromId, toId],
      });
      // Stock updates
      tx.push({
        sql: `UPDATE stock s SET quantity = s.quantity - sub.qty, updated_at = NOW()
                FROM (SELECT product_id, SUM(quantity) AS qty FROM warehouse_transfer_lines WHERE transfer_id = $1::uuid GROUP BY product_id) sub
               WHERE s.company_id = $2::uuid AND s.warehouse_id = $3::uuid AND s.product_id = sub.product_id`,
        params: [id, companyId, fromId],
      });
      tx.push({
        sql: `UPDATE stock s SET quantity = s.quantity + sub.qty, updated_at = NOW()
                FROM (SELECT product_id, SUM(quantity) AS qty FROM warehouse_transfer_lines WHERE transfer_id = $1::uuid GROUP BY product_id) sub
               WHERE s.company_id = $2::uuid AND s.warehouse_id = $3::uuid AND s.product_id = sub.product_id`,
        params: [id, companyId, toId],
      });
      // Flip status
      tx.push({
        sql: `UPDATE warehouse_transfers SET status = 'completed', updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
        params: [id, companyId, safeUserId(_userId)],
      });
      const result = await adapter.transaction(tx);
      return result.success ? { success: true } : { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Inventory Transactions (backed by stock_movements) ────────────────────
  async getInventoryTransactions(companyId: string): Promise<{ success: boolean; data?: InventoryTransaction[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT sm.id, sm.company_id, sm.product_id, sm.warehouse_id, sm.type, sm.quantity,
                sm.reference, sm.notes, sm.created_at,
                p.name_ar AS product_name, p.code AS product_code,
                w.name AS warehouse_name
           FROM stock_movements sm
           LEFT JOIN products p ON p.id = sm.product_id
           LEFT JOIN warehouses w ON w.id = sm.warehouse_id
          WHERE sm.company_id = $1
          ORDER BY sm.created_at DESC`,
        [companyId]
      );
      if (result.success) {
        return { success: true, data: mapRows<InventoryTransaction>(result.rows) };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async getInventoryTransactionsPaginated(
    companyId: string,
    page: number,
    pageSize: number,
    filters?: { type?: string; productId?: string }
  ): Promise<PaginatedQueryResult<InventoryTransaction>> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const { page: p, pageSize: ps, offset } = clampPageArgs(page, pageSize);
      const adapter = await getDbAdapter();

      const conditions: string[] = ['sm.company_id = $1'];
      const params: unknown[] = [companyId];
      if (filters?.type) {
        params.push(filters.type);
        conditions.push(`sm.type = $${params.length}`);
      }
      if (filters?.productId) {
        params.push(filters.productId);
        conditions.push(`sm.product_id = $${params.length}`);
      }
      const where = conditions.join(' AND ');

      const countResult = await adapter.query(
        `SELECT COUNT(*)::int AS total FROM stock_movements sm WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows?.[0]?.total || 0);

      params.push(ps);
      params.push(offset);
      const limitIdx = params.length - 1;
      const offsetIdx = params.length;

      const dataResult = await adapter.query(
        `SELECT sm.*, p.name_ar as product_name, w.name as warehouse_name
         FROM stock_movements sm
         LEFT JOIN products p ON sm.product_id = p.id
         LEFT JOIN warehouses w ON sm.warehouse_id = w.id
         WHERE ${where}
         ORDER BY sm.created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );
      if (!dataResult.success) return { success: false, error: dataResult.error };

      const items = mapRows<InventoryTransaction>(dataResult.rows || []);
      return { success: true, data: paginatedResult(items, total, p, ps) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createInventoryTransaction(data: Omit<InventoryTransaction, 'id'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createInventoryTransactionSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      const adapter = await getDbAdapter();
      const qty = Number(data.quantity) || 0;
      const delta = data.type === 'out' ? -qty : qty;
      // Skip stock update for transfers (handled by dedicated transfer flow)
      if (data.type === 'transfer') {
        const result = await adapter.query(
          `INSERT INTO stock_movements (company_id, type, product_id, warehouse_id, quantity, reference, notes, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [data.companyId, data.type, data.productId, data.warehouseId, qty, data.reference ?? null, data.notes ?? null, safeUserId(_userId), safeUserId(_userId)]
        );
        if (result.success && result.rows?.[0]) return { success: true, id: result.rows[0].id };
        return { success: false, error: result.error };
      }
      const tx = await adapter.transaction([
        {
          sql: `INSERT INTO stock_movements (company_id, type, product_id, warehouse_id, quantity, reference, notes, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          params: [data.companyId, data.type, data.productId, data.warehouseId, qty, data.reference ?? null, data.notes ?? null, safeUserId(_userId), safeUserId(_userId)],
        },
        {
          sql: `INSERT INTO stock (company_id, product_id, warehouse_id, quantity) SELECT $1::uuid, $2::uuid, $3::uuid, 0 WHERE NOT EXISTS (SELECT 1 FROM stock WHERE company_id = $1::uuid AND product_id = $2::uuid AND warehouse_id = $3::uuid)`,
          params: [data.companyId, data.productId, data.warehouseId],
        },
        {
          sql: `UPDATE stock SET quantity = quantity + $1::numeric, updated_at = NOW() WHERE company_id = $2::uuid AND product_id = $3::uuid AND warehouse_id = $4::uuid`,
          params: [delta, data.companyId, data.productId, data.warehouseId],
        },
      ]);
      if (!tx.success) return { success: false, error: tx.error };
      const first = (tx.results?.[0] as { rows?: Array<{ id: string }> } | undefined)?.rows?.[0];
      return { success: true, id: first?.id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteInventoryTransaction(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      return adapter.query('DELETE FROM stock_movements WHERE id = $1 AND company_id = $2', [id, companyId]);
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Stock Adjustments ──────────────────────────────────────────────────────
  async getStockAdjustments(companyId: string): Promise<{ success: boolean; data?: StockAdjustment[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `SELECT sa.*, p.name_ar AS product_name, p.code AS product_code,
                w.name AS warehouse_name, u.username AS approved_by_name
           FROM stock_adjustments sa
           LEFT JOIN products p ON p.id = sa.product_id
           LEFT JOIN warehouses w ON w.id = sa.warehouse_id
           LEFT JOIN users u ON u.id = sa.approved_by
          WHERE sa.company_id = $1
          ORDER BY sa.date DESC, sa.created_at DESC`,
        [companyId]
      );
      if (result.success) {
        return { success: true, data: mapRows<StockAdjustment>(result.rows) };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createStockAdjustment(data: Omit<StockAdjustment, 'id'>, _userId?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createStockAdjustmentSchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        `INSERT INTO stock_adjustments (company_id, date, adjustment_number, product_id, warehouse_id, system_qty, actual_qty, difference, reason, status, unit_cost, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
        [data.companyId, data.date, data.adjustmentNumber ?? null, data.productId, data.warehouseId, data.systemQty, data.actualQty, data.difference, data.reason ?? null, data.status ?? 'draft', data.unitCost ?? null, safeUserId(_userId), safeUserId(_userId)]
      );
      if (result.success && result.rows?.[0]) {
        return { success: true, id: result.rows[0].id };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateStockAdjustment(id: string, companyId: string, data: Partial<StockAdjustment>, _updatedBy?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (data.systemQty !== undefined) { fields.push(`system_qty = $${idx++}`); params.push(data.systemQty); }
      if (data.actualQty !== undefined) { fields.push(`actual_qty = $${idx++}`); params.push(data.actualQty); }
      if (data.difference !== undefined) { fields.push(`difference = $${idx++}`); params.push(data.difference); }
      if (data.reason !== undefined) { fields.push(`reason = $${idx++}`); params.push(data.reason); }
      if (data.status !== undefined) { fields.push(`status = $${idx++}`); params.push(data.status); }
      if (data.unitCost !== undefined) { fields.push(`unit_cost = $${idx++}`); params.push(data.unitCost); }
      if (data.warehouseId !== undefined) { fields.push(`warehouse_id = $${idx++}`); params.push(data.warehouseId); }
      fields.push(`updated_by = $${idx++}`);
      params.push(_updatedBy || null);
      fields.push('updated_at = NOW()');
      if (fields.length === 0) return { success: true };
      params.push(id);
      params.push(companyId);
      return adapter.query(
        `UPDATE stock_adjustments SET ${fields.join(', ')} WHERE id = $${idx++} AND company_id = $${idx}`,
        params
      );
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async approveStockAdjustment(id: string, companyId: string, approvedBy: string, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      return adapter.query(
        `UPDATE stock_adjustments SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_by = $4, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
        [approvedBy, id, companyId, safeUserId(_userId)]
      );
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async postStockAdjustment(id: string, companyId: string, _userId?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const chk = await adapter.query(
        `SELECT sa.product_id, sa.warehouse_id, sa.system_qty, sa.actual_qty, sa.difference, sa.reason, sa.date, p.name_ar AS product_name
           FROM stock_adjustments sa LEFT JOIN products p ON p.id = sa.product_id
          WHERE sa.id = $1 AND sa.company_id = $2 AND sa.status IN ('draft','approved')`,
        [id, companyId]
      );
      if (!chk.success || !chk.rows?.[0]) return { success: false, error: 'Adjustment not found or not in draft/approved status' };
      const adj = chk.rows[0] as Record<string, unknown>;
      const productId = String(adj.product_id);
      const warehouseId = String(adj.warehouse_id);
      const difference = Number(adj.difference) || 0;
      const actualQty = Number(adj.actual_qty) || 0;
      const productName = String(adj.product_name || productId);
      const reason = String(adj.reason || '');
      const adjDate = String(adj.date || new Date().toISOString().split('T')[0]);
      const tx: Array<{ sql: string; params?: unknown[] }> = [];
      // Ensure stock row exists
      tx.push({
        sql: `INSERT INTO stock (company_id, product_id, warehouse_id, quantity) SELECT $1::uuid, $2::uuid, $3::uuid, 0 WHERE NOT EXISTS (SELECT 1 FROM stock WHERE company_id = $1::uuid AND product_id = $2::uuid AND warehouse_id = $3::uuid)`,
        params: [companyId, productId, warehouseId],
      });
      // Movement
      tx.push({
        sql: `INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, reference, notes, created_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 'adjustment', $4::numeric, $5, $6, NOW())`,
        params: [companyId, productId, warehouseId, Math.abs(difference), `ADJ-${id}`, reason || 'تسوية جرد'],
      });
      // Update stock to actual quantity
      tx.push({
        sql: `UPDATE stock SET quantity = $1::numeric, updated_at = NOW() WHERE company_id = $2::uuid AND product_id = $3::uuid AND warehouse_id = $4::uuid`,
        params: [actualQty, companyId, productId, warehouseId],
      });
      // Journal entry if difference != 0
      if (difference !== 0) {
        const { buildStockAdjustmentPostingStatements } = await import('@/core/utils/journalEntryGenerator');
        const je = await buildStockAdjustmentPostingStatements(companyId, { product: productName, difference, reason, date: adjDate, id });
        if (!je.success) return { success: false, error: je.error };
        for (const s of je.statements) tx.push({ sql: s.sql, params: s.params as unknown[] });
      }
      // Flip status
      tx.push({
        sql: `UPDATE stock_adjustments SET status = 'posted', posted_at = NOW(), updated_by = $3::uuid, updated_at = NOW() WHERE id = $1::uuid AND company_id = $2::uuid`,
        params: [id, companyId, safeUserId(_userId)],
      });
      const result = await adapter.transaction(tx);
      return result.success ? { success: true } : { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteStockAdjustment(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      return adapter.query('DELETE FROM stock_adjustments WHERE id = $1 AND company_id = $2', [id, companyId]);
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Categories ───────────────────────────────────────────────────────────
  async getCategories(companyId: string): Promise<{ success: boolean; data?: ProductCategory[]; error?: string }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        'SELECT * FROM product_categories WHERE company_id = $1 ORDER BY name',
        [companyId]
      );
      if (result.success) {
        return { success: true, data: mapRows<ProductCategory>(result.rows) };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async createProductCategory(data: Omit<ProductCategory, 'id'>): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const validation = validateInput(createProductCategorySchema, data);
      if (!validation.success) return { success: false, error: validation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query(
        'INSERT INTO product_categories (company_id, name, parent_id) VALUES ($1, $2, $3) RETURNING id',
        [data.companyId, data.name, data.parentId ?? null]
      );
      if (result.success && result.rows?.[0]) {
        return { success: true, id: result.rows[0].id };
      }
      return { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async updateProductCategory(id: string, companyId: string, data: Partial<ProductCategory>): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const fields: string[] = [];
      const params: unknown[] = [];
      let idx = 1;
      if (data.name !== undefined) { fields.push(`name = $${idx++}`); params.push(data.name); }
      if (data.parentId !== undefined) { fields.push(`parent_id = $${idx++}`); params.push(data.parentId); }
      if (fields.length === 0) return { success: true };
      params.push(id);
      params.push(companyId);
      return adapter.query(
        `UPDATE product_categories SET ${fields.join(', ')} WHERE id = $${idx++} AND company_id = $${idx}`,
        params
      );
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  async deleteProductCategory(id: string, companyId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const idValidation = validateInput(idCompanySchema, { id, companyId });
      if (!idValidation.success) return { success: false, error: idValidation.error };
      const adapter = await getDbAdapter();
      const result = await adapter.query('DELETE FROM product_categories WHERE id = $1 AND company_id = $2', [id, companyId]);
      return result.success ? { success: true } : { success: false, error: result.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ─── Dashboard KPIs ────────────────────────────────────────────────────────────
  async getInventoryKpis(companyId: string): Promise<{
    success: boolean;
    data?: {
      stockValue: number;
      lowStockItems: number;
      warehouseCount: number;
      stockMovementsCount: number;
    };
    error?: string;
  }> {
    try {
      const cidValidation = validateInput(companyIdSchema, companyId);
      if (!cidValidation.success) return { success: false, error: cidValidation.error };
      const adapter = await getDbAdapter();
      const [stockResult, lowStockResult, whResult, movResult] = await Promise.all([
        adapter.query<{ total: string | number }>(
          `SELECT COALESCE(SUM(s.quantity * p.cost_price), 0) AS total
             FROM stock s
             JOIN products p ON s.product_id = p.id
            WHERE p.company_id = $1 AND p.is_active = true`,
          [companyId],
        ),
        adapter.query<{ cnt: string | number }>(
          `SELECT COUNT(*)::int AS cnt
             FROM stock s
             JOIN products p ON s.product_id = p.id
            WHERE p.company_id = $1 AND p.is_active = true
              AND s.min_stock_alert IS NOT NULL
              AND s.quantity <= s.min_stock_alert`,
          [companyId],
        ),
        adapter.query<{ cnt: string | number }>(
          `SELECT COUNT(*)::int AS cnt FROM warehouses WHERE company_id = $1`,
          [companyId],
        ),
        adapter.query<{ cnt: string | number }>(
          `SELECT COUNT(*)::int AS cnt FROM stock_movements WHERE company_id = $1`,
          [companyId],
        ),
      ]);
      return {
        success: true,
        data: {
          stockValue: Number(stockResult.rows?.[0]?.total || 0),
          lowStockItems: Number(lowStockResult.rows?.[0]?.cnt || 0),
          warehouseCount: Number(whResult.rows?.[0]?.cnt || 0),
          stockMovementsCount: Number(movResult.rows?.[0]?.cnt || 0),
        },
      };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};
