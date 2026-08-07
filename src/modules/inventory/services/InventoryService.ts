import { BaseService } from '@/core/services/BaseService';
import { z } from 'zod';

// Validation schemas
const CreateProductSchema = z.object({
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
  categoryId: z.string().uuid().nullable(),
  unitId: z.string().uuid(),
  costPrice: z.number().min(0),
  salePrice: z.number().min(0),
  minStock: z.number().min(0).default(0),
  maxStock: z.number().min(0).default(0),
  barcode: z.string().optional(),
  sku: z.string().optional(),
  vatRate: z.number().min(0).default(0),
  isActive: z.boolean().default(true),
});

const CreateStockMovementSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: z.number(),
  movementType: z.enum(['in', 'out', 'transfer']),
  reference: z.string().optional(),
  notes: z.string().optional(),
  relatedDocumentId: z.string().uuid().optional(),
  relatedDocumentType: z.enum(['purchase_invoice', 'sales_invoice', 'stock_adjustment', 'transfer']).optional(),
});

export type CreateProductDto = z.infer<typeof CreateProductSchema>;
export type CreateStockMovementDto = z.infer<typeof CreateStockMovementSchema>;

/**
 * Inventory Service
 * 
 * Encapsulates all business logic for inventory operations:
 * - Product management
 * - Stock movements
 * - Warehouse management
 * - Stock valuation
 * - Low stock alerts
 */
export class InventoryService extends BaseService {
  /**
   * Create a new product
   */
  async createProduct(data: CreateProductDto) {
    this.requirePermission('inventory.create');
    
    return this.executeWithErrorHandling(async () => {
      const validated = CreateProductSchema.parse(data);
      const companyId = this.getCompanyId();
      
      // Check if code already exists
      const existing = await this.query(
        'SELECT id FROM products WHERE company_id = $1::uuid AND code = $2',
        [companyId, validated.code]
      );
      
      if (existing.success && existing.rows && existing.rows.length > 0) {
        throw new Error('Product code already exists');
      }
      
      // Create product
      const result = await this.query(
        `INSERT INTO products 
         (id, company_id, code, name_ar, name_en, category_id, unit_id, cost_price, sale_price, 
          min_stock, max_stock, barcode, sku, vat_rate, is_active)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7::uuid, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id`,
        [
          crypto.randomUUID(),
          companyId,
          validated.code,
          validated.nameAr,
          validated.nameEn,
          validated.categoryId,
          validated.unitId,
          validated.costPrice,
          validated.salePrice,
          validated.minStock,
          validated.maxStock,
          validated.barcode || null,
          validated.sku || null,
          validated.vatRate,
          validated.isActive,
        ]
      );
      
      if (!result.success || !result.rows || result.rows.length === 0) {
        throw new Error(result.error || 'Failed to create product');
      }
      
      const productId = String(result.rows[0].id);
      
      // Audit log
      await this.auditLog({
        tableName: 'products',
        recordId: productId,
        action: 'create',
        newValues: {
          code: validated.code,
          nameAr: validated.nameAr,
          costPrice: validated.costPrice,
          salePrice: validated.salePrice,
        },
      });
      
      return { success: true, id: productId };
    }, 'createProduct');
  }

  /**
   * Create a stock movement
   * 
   * This is a critical operation that:
   * 1. Validates the movement (sufficient stock for outgoing)
   * 2. Updates product stock quantity
   * 3. Creates stock movement record
   * 4. Updates warehouse stock (if applicable)
   * 5. Is performed atomically (transaction-safe)
   */
  async createStockMovement(data: CreateStockMovementDto) {
    this.requirePermission('inventory.edit');
    
    return this.executeWithErrorHandling(async () => {
      const validated = CreateStockMovementSchema.parse(data);
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();
      
      // Get current stock
      const stockResult = await this.query(
        `SELECT stock_qty FROM products 
         WHERE id = $1::uuid AND company_id = $2::uuid`,
        [validated.productId, companyId]
      );
      
      if (!stockResult.success || !stockResult.rows || stockResult.rows.length === 0) {
        throw new Error('Product not found');
      }
      
      const currentStock = Number(stockResult.rows[0].stock_qty || 0);
      
      // Validate outgoing movement
      if (validated.movementType === 'out' && currentStock < Math.abs(validated.quantity)) {
        throw new Error(`Insufficient stock: current=${currentStock}, requested=${Math.abs(validated.quantity)}`);
      }
      
      // Calculate new stock
      const newStock = validated.movementType === 'in' 
        ? currentStock + validated.quantity 
        : currentStock - Math.abs(validated.quantity);
      
      // Build transaction queries
      const movementId = crypto.randomUUID();
      const queries: { sql: string; params: unknown[] }[] = [
        // Create stock movement
        {
          sql: `INSERT INTO stock_movements 
                (id, company_id, product_id, warehouse_id, quantity, movement_type, 
                 reference, notes, related_document_id, related_document_type, created_by)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::uuid, $10, $11::uuid)`,
          params: [
            movementId,
            companyId,
            validated.productId,
            validated.warehouseId,
            validated.quantity,
            validated.movementType,
            validated.reference || null,
            validated.notes || null,
            validated.relatedDocumentId || null,
            validated.relatedDocumentType || null,
            userId,
          ],
        },
        // Update product stock
        {
          sql: `UPDATE products 
                SET stock_qty = $1 
                WHERE id = $2::uuid AND company_id = $3::uuid`,
          params: [newStock, validated.productId, companyId],
        },
      ];
      
      // Update warehouse stock if warehouse is specified
      if (validated.warehouseId) {
        queries.push({
          sql: `INSERT INTO warehouse_stocks (warehouse_id, product_id, company_id, quantity)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
                ON CONFLICT (warehouse_id, product_id) 
                DO UPDATE SET quantity = warehouse_stocks.quantity + $4`,
          params: [
            validated.warehouseId,
            validated.productId,
            companyId,
            validated.movementType === 'in' ? validated.quantity : -Math.abs(validated.quantity),
          ],
        });
      }
      
      // Execute transaction atomically
      const result = await this.transaction(queries);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to create stock movement');
      }
      
      // Audit log
      await this.auditLog({
        tableName: 'stock_movements',
        recordId: movementId,
        action: 'create',
        newValues: {
          productId: validated.productId,
          warehouseId: validated.warehouseId,
          quantity: validated.quantity,
          movementType: validated.movementType,
          previousStock: currentStock,
          newStock,
        },
      });
      
      return { success: true, id: movementId, newStock };
    }, 'createStockMovement');
  }

  /**
   * Get products with pagination
   */
  async getProductsPaginated(page: number, pageSize: number, filters?: {
    categoryId?: string;
    isActive?: boolean;
    search?: string;
    lowStock?: boolean;
  }) {
    this.requirePermission('inventory.view');
    
    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      const offset = (page - 1) * pageSize;
      
      const conditions: string[] = ['p.company_id = $1::uuid'];
      const params: unknown[] = [companyId];
      let paramIndex = 2;
      
      if (filters?.categoryId) {
        conditions.push(`p.category_id = $${paramIndex}::uuid`);
        params.push(filters.categoryId);
        paramIndex++;
      }
      
      if (filters?.isActive !== undefined) {
        conditions.push(`p.is_active = $${paramIndex}`);
        params.push(filters.isActive);
        paramIndex++;
      }
      
      if (filters?.search) {
        conditions.push(`(p.name_ar ILIKE $${paramIndex} OR p.name_en ILIKE $${paramIndex} OR p.code ILIKE $${paramIndex})`);
        params.push(`%${filters.search}%`);
        paramIndex++;
      }
      
      if (filters?.lowStock) {
        conditions.push(`p.stock_qty <= p.min_stock`);
      }
      
      const whereClause = conditions.join(' AND ');
      
      // Get total count
      const countResult = await this.query(
        `SELECT COUNT(*) as total FROM products p WHERE ${whereClause}`,
        params
      );
      
      // Get paginated data
      const dataResult = await this.query(
        `SELECT p.*, c.name as category_name, u.name as unit_name 
         FROM products p 
         LEFT JOIN categories c ON p.category_id = c.id 
         LEFT JOIN units u ON p.unit_id = u.id 
         WHERE ${whereClause}
         ORDER BY p.code ASC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, pageSize, offset]
      );
      
      if (!dataResult.success) {
        throw new Error(dataResult.error || 'Failed to get products');
      }
      
      const total = countResult.success && countResult.rows && countResult.rows[0] 
        ? Number(countResult.rows[0].total) 
        : 0;
      
      return {
        success: true,
        data: {
          items: dataResult.rows || [],
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    }, 'getProductsPaginated');
  }

  /**
   * Get low stock products
   */
  async getLowStockProducts() {
    this.requirePermission('inventory.view');
    
    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      
      const result = await this.query(
        `SELECT p.*, c.name as category_name, u.name as unit_name,
                (p.min_stock - p.stock_qty) as shortage
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN units u ON p.unit_id = u.id
         WHERE p.company_id = $1::uuid 
           AND p.stock_qty <= p.min_stock 
           AND p.is_active = true
         ORDER BY (p.min_stock - p.stock_qty) DESC`,
        [companyId]
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to get low stock products');
      }
      
      return { success: true, data: result.rows || [] };
    }, 'getLowStockProducts');
  }

  /**
   * Get stock movements for a product
   */
  async getProductStockMovements(productId: string, page: number, pageSize: number) {
    this.requirePermission('inventory.view');
    
    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      const offset = (page - 1) * pageSize;
      
      // Get total count
      const countResult = await this.query(
        `SELECT COUNT(*) as total FROM stock_movements 
         WHERE company_id = $1::uuid AND product_id = $2::uuid`,
        [companyId, productId]
      );
      
      // Get paginated data
      const dataResult = await this.query(
        `SELECT sm.*, p.name_ar as product_name, p.code as product_code, w.name as warehouse_name
         FROM stock_movements sm
         JOIN products p ON sm.product_id = p.id
         LEFT JOIN warehouses w ON sm.warehouse_id = w.id
         WHERE sm.company_id = $1::uuid AND sm.product_id = $2::uuid
         ORDER BY sm.created_at DESC
         LIMIT $3 OFFSET $4`,
        [companyId, productId, pageSize, offset]
      );
      
      if (!dataResult.success) {
        throw new Error(dataResult.error || 'Failed to get stock movements');
      }
      
      const total = countResult.success && countResult.rows && countResult.rows[0] 
        ? Number(countResult.rows[0].total) 
        : 0;
      
      return {
        success: true,
        data: {
          items: dataResult.rows || [],
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    }, 'getProductStockMovements');
  }

  /**
   * Get inventory valuation
   */
  async getInventoryValuation() {
    this.requirePermission('inventory.view');
    
    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      
      const result = await this.query(
        `SELECT 
          COUNT(*) as total_products,
          SUM(stock_qty * cost_price) as total_value,
          SUM(stock_qty) as total_quantity,
          SUM(CASE WHEN stock_qty <= min_stock THEN 1 ELSE 0 END) as low_stock_count
         FROM products
         WHERE company_id = $1::uuid AND is_active = true`,
        [companyId]
      );
      
      if (!result.success || !result.rows || result.rows.length === 0) {
        throw new Error(result.error || 'Failed to get inventory valuation');
      }
      
      return { success: true, data: result.rows[0] };
    }, 'getInventoryValuation');
  }
}

// Singleton instance
export const inventoryService = new InventoryService();
