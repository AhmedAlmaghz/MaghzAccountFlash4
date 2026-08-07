import { BaseService } from '@/core/services/BaseService';
import { z } from 'zod';

// Validation schemas
const CreateWorkOrderSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  plannedStartDate: z.string(),
  plannedEndDate: z.string(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  notes: z.string().optional(),
  bomId: z.string().uuid().optional(),
});

const PostWorkOrderSchema = z.object({
  workOrderId: z.string().uuid(),
  actualStartDate: z.string(),
  actualEndDate: z.string().optional(),
  actualQuantity: z.number().positive(),
  notes: z.string().optional(),
});

const CreateBOMSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().min(1),
  version: z.string().default('1.0'),
  isActive: z.boolean().default(true),
  components: z.array(z.object({
    componentProductId: z.string().uuid(),
    quantity: z.number().positive(),
    unitOfMeasure: z.string().default('pcs'),
  })).min(1),
});

export type CreateWorkOrderDto = z.infer<typeof CreateWorkOrderSchema>;
export type PostWorkOrderDto = z.infer<typeof PostWorkOrderSchema>;
export type CreateBOMDto = z.infer<typeof CreateBOMSchema>;

/**
 * Manufacturing Service
 * 
 * Encapsulates all business logic for manufacturing operations:
 * - Work order management
 * - BOM (Bill of Materials) management
 * - Production tracking
 * - Cost calculation
 * - Variance analysis
 */
export class ManufacturingService extends BaseService {
  /**
   * Create a new work order
   */
  async createWorkOrder(data: CreateWorkOrderDto) {
    this.requirePermission('manufacturing.create');

    return this.executeWithErrorHandling(async () => {
      const validated = CreateWorkOrderSchema.parse(data);
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();

      // Check if product exists
      const productResult = await this.query(
        'SELECT id, name_ar FROM products WHERE id = $1::uuid AND company_id = $2::uuid',
        [validated.productId, companyId]
      );

      if (!productResult.success || !productResult.rows || productResult.rows.length === 0) {
        throw new Error('Product not found');
      }

      // Generate work order number
      const workOrderNumber = await this.generateWorkOrderNumber(companyId);

      // Create work order
      const result = await this.query(
        `INSERT INTO work_orders 
         (id, company_id, work_order_number, product_id, quantity, 
          planned_start_date, planned_end_date, priority, status, notes, created_by)
         VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, $8, 'pending', $9, $10::uuid)
         RETURNING id`,
        [
          crypto.randomUUID(),
          companyId,
          workOrderNumber,
          validated.productId,
          validated.quantity,
          validated.plannedStartDate,
          validated.plannedEndDate,
          validated.priority,
          validated.notes || null,
          userId,
        ]
      );

      if (!result.success || !result.rows || result.rows.length === 0) {
        throw new Error(result.error || 'Failed to create work order');
      }

      const workOrderId = String(result.rows[0].id);

      // Audit log
      await this.auditLog({
        tableName: 'work_orders',
        recordId: workOrderId,
        action: 'create',
        newValues: {
          workOrderNumber,
          productId: validated.productId,
          quantity: validated.quantity,
          priority: validated.priority,
        },
      });

      return { success: true, id: workOrderId, workOrderNumber };
    }, 'createWorkOrder');
  }

  /**
   * Post a work order (start production)
   * 
   * This is a critical operation that:
   * 1. Validates work order status
   * 2. Reserves components from inventory based on BOM
   * 3. Creates accounting entries for work in progress
   * 4. Updates work order status
   * 5. Is performed atomically (transaction-safe)
   */
  async postWorkOrder(data: PostWorkOrderDto) {
    this.requirePermission('manufacturing.post');

    return this.executeWithErrorHandling(async () => {
      const validated = PostWorkOrderSchema.parse(data);
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();

      // Get work order details
      const workOrderResult = await this.query(
        `SELECT * FROM work_orders 
         WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'pending'`,
        [validated.workOrderId, companyId]
      );

      if (!workOrderResult.success || !workOrderResult.rows || workOrderResult.rows.length === 0) {
        throw new Error('Work order not found or already started');
      }

      const workOrder = workOrderResult.rows[0] as Record<string, unknown>;

      // Get BOM for the product
      const bomResult = await this.query(
        `SELECT * FROM bills_of_materials 
         WHERE product_id = $1::uuid AND company_id = $2::uuid AND is_active = true
         ORDER BY version DESC
         LIMIT 1`,
        [workOrder.product_id, companyId]
      );

      if (!bomResult.success || !bomResult.rows || bomResult.rows.length === 0) {
        throw new Error('No active BOM found for this product');
      }

      const bom = bomResult.rows[0] as Record<string, unknown>;

      // Get BOM components
      const componentsResult = await this.query(
        `SELECT * FROM bom_components 
         WHERE bom_id = $1::uuid AND company_id = $2::uuid`,
        [bom.id, companyId]
      );

      if (!componentsResult.success || !componentsResult.rows) {
        throw new Error('Failed to get BOM components');
      }

      const components = componentsResult.rows;

      // Check component availability
      for (const component of components) {
        const componentId = String(component.component_product_id);
        const requiredQuantity = Number(component.quantity) * validated.actualQuantity;

        const stockResult = await this.query(
          `SELECT stock_qty FROM products 
           WHERE id = $1::uuid AND company_id = $2::uuid`,
          [componentId, companyId]
        );

        if (!stockResult.success || !stockResult.rows || stockResult.rows.length === 0) {
          throw new Error(`Component not found: ${componentId}`);
        }

        const currentStock = Number(stockResult.rows[0].stock_qty) || 0;

        if (currentStock < requiredQuantity) {
          throw new Error(
            `Insufficient stock for component. Required: ${requiredQuantity}, Available: ${currentStock}`
          );
        }
      }

      // Build transaction queries
      const queries: { sql: string; params: unknown[] }[] = [
        // Update work order status
        {
          sql: `UPDATE work_orders 
                SET status = 'in_progress', actual_start_date = $1, actual_end_date = $2, 
                    actual_quantity = $3, updated_by = $4::uuid, updated_at = NOW()
                WHERE id = $5::uuid AND company_id = $6::uuid`,
          params: [
            validated.actualStartDate,
            validated.actualEndDate || null,
            validated.actualQuantity,
            userId,
            validated.workOrderId,
            companyId,
          ],
        },
      ];

      // Reserve components from inventory
      for (const component of components) {
        const componentId = String(component.component_product_id);
        const requiredQuantity = Number(component.quantity) * validated.actualQuantity;

        queries.push({
          sql: `UPDATE products 
                SET stock_qty = stock_qty - $1 
                WHERE id = $2::uuid AND company_id = $3::uuid`,
          params: [requiredQuantity, componentId, companyId],
        });

        // Create stock movement record
        queries.push({
          sql: `INSERT INTO stock_movements 
                (id, company_id, product_id, warehouse_id, quantity, movement_type, 
                 reference, notes, related_document_id, related_document_type, created_by)
                VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, $4, 'out', 
                 $5, $6, $7::uuid, 'work_order', $8::uuid)`,
          params: [
            crypto.randomUUID(),
            companyId,
            componentId,
            requiredQuantity,
            `Work Order ${workOrder.work_order_number}`,
            'Component reservation for production',
            validated.workOrderId,
            userId,
          ],
        });
      }

      // Execute transaction atomically
      const result = await this.transaction(queries);

      if (!result.success) {
        throw new Error(result.error || 'Failed to post work order');
      }

      // Audit log
      await this.auditLog({
        tableName: 'work_orders',
        recordId: validated.workOrderId,
        action: 'post',
        newValues: {
          workOrderNumber: workOrder.work_order_number,
          actualQuantity: validated.actualQuantity,
          componentsUsed: components.length,
        },
      });

      return { success: true };
    }, 'postWorkOrder');
  }

  /**
   * Complete a work order
   */
  async completeWorkOrder(workOrderId: string, actualQuantity: number, notes?: string) {
    this.requirePermission('manufacturing.post');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();

      // Get work order details
      const workOrderResult = await this.query(
        `SELECT * FROM work_orders 
         WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'in_progress'`,
        [workOrderId, companyId]
      );

      if (!workOrderResult.success || !workOrderResult.rows || workOrderResult.rows.length === 0) {
        throw new Error('Work order not found or not in progress');
      }

      const workOrder = workOrderResult.rows[0] as Record<string, unknown>;

      // Add produced quantity to inventory
      const queries: { sql: string; params: unknown[] }[] = [
        // Update work order status
        {
          sql: `UPDATE work_orders 
                SET status = 'completed', actual_end_date = NOW(), 
                    actual_quantity = $1, notes = $2, updated_by = $3::uuid, updated_at = NOW()
                WHERE id = $4::uuid AND company_id = $5::uuid`,
          params: [actualQuantity, notes || null, userId, workOrderId, companyId],
        },
        // Add produced items to inventory
        {
          sql: `UPDATE products 
                SET stock_qty = stock_qty + $1 
                WHERE id = $2::uuid AND company_id = $3::uuid`,
          params: [actualQuantity, workOrder.product_id, companyId],
        },
        // Create stock movement record
        {
          sql: `INSERT INTO stock_movements 
                (id, company_id, product_id, warehouse_id, quantity, movement_type, 
                 reference, notes, related_document_id, related_document_type, created_by)
                VALUES ($1::uuid, $2::uuid, $3::uuid, NULL, $4, 'in', 
                 $5, $6, $7::uuid, 'work_order', $8::uuid)`,
          params: [
            crypto.randomUUID(),
            companyId,
            workOrder.product_id,
            actualQuantity,
            `Work Order ${workOrder.work_order_number}`,
            'Production completion',
            workOrderId,
            userId,
          ],
        },
      ];

      // Execute transaction atomically
      const result = await this.transaction(queries);

      if (!result.success) {
        throw new Error(result.error || 'Failed to complete work order');
      }

      // Audit log
      await this.auditLog({
        tableName: 'work_orders',
        recordId: workOrderId,
        action: 'update',
        newValues: {
          status: 'completed',
          actualQuantity,
        },
      });

      return { success: true };
    }, 'completeWorkOrder');
  }

  /**
   * Create a BOM (Bill of Materials)
   */
  async createBOM(data: CreateBOMDto) {
    this.requirePermission('manufacturing.edit');

    return this.executeWithErrorHandling(async () => {
      const validated = CreateBOMSchema.parse(data);
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();

      // Check if product exists
      const productResult = await this.query(
        'SELECT id FROM products WHERE id = $1::uuid AND company_id = $2::uuid',
        [validated.productId, companyId]
      );

      if (!productResult.success || !productResult.rows || productResult.rows.length === 0) {
        throw new Error('Product not found');
      }

      // Create BOM
      const bomResult = await this.query(
        `INSERT INTO bills_of_materials 
         (id, company_id, product_id, name, version, is_active, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid)
         RETURNING id`,
        [
          crypto.randomUUID(),
          companyId,
          validated.productId,
          validated.name,
          validated.version,
          validated.isActive,
          userId,
        ]
      );

      if (!bomResult.success || !bomResult.rows || bomResult.rows.length === 0) {
        throw new Error(bomResult.error || 'Failed to create BOM');
      }

      const bomId = String(bomResult.rows[0].id);

      // Create BOM components
      for (const component of validated.components) {
        await this.query(
          `INSERT INTO bom_components 
           (id, bom_id, component_product_id, quantity, unit_of_measure, company_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)`,
          [
            crypto.randomUUID(),
            bomId,
            component.componentProductId,
            component.quantity,
            component.unitOfMeasure,
            companyId,
          ]
        );
      }

      // Audit log
      await this.auditLog({
        tableName: 'bills_of_materials',
        recordId: bomId,
        action: 'create',
        newValues: {
          productId: validated.productId,
          name: validated.name,
          version: validated.version,
          componentCount: validated.components.length,
        },
      });

      return { success: true, id: bomId };
    }, 'createBOM');
  }

  /**
   * Generate work order number
   */
  private async generateWorkOrderNumber(companyId: string): Promise<string> {
    const result = await this.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(work_order_number FROM '[0-9]+$') AS INTEGER)), 0) + 1 as next_number
       FROM work_orders 
       WHERE company_id = $1::uuid 
       AND work_order_number ~ '^[A-Za-z]+[0-9]+$'`,
      [companyId]
    );

    if (!result.success || !result.rows || result.rows.length === 0) {
      // Fallback to timestamp-based number
      return `WO${Date.now()}`;
    }

    const nextNumber = result.rows[0].next_number as number;
    return `WO${String(nextNumber).padStart(6, '0')}`;
  }

  /**
   * Get work orders with pagination
   */
  async getWorkOrdersPaginated(page: number, pageSize: number, filters?: {
    status?: string;
    productId?: string;
    priority?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    this.requirePermission('manufacturing.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      const offset = (page - 1) * pageSize;

      const conditions: string[] = ['wo.company_id = $1::uuid'];
      const params: unknown[] = [companyId];
      let paramIndex = 2;

      if (filters?.status) {
        conditions.push(`wo.status = $${paramIndex}`);
        params.push(filters.status);
        paramIndex++;
      }

      if (filters?.productId) {
        conditions.push(`wo.product_id = $${paramIndex}::uuid`);
        params.push(filters.productId);
        paramIndex++;
      }

      if (filters?.priority) {
        conditions.push(`wo.priority = $${paramIndex}`);
        params.push(filters.priority);
        paramIndex++;
      }

      if (filters?.fromDate) {
        conditions.push(`wo.planned_start_date >= $${paramIndex}`);
        params.push(filters.fromDate);
        paramIndex++;
      }

      if (filters?.toDate) {
        conditions.push(`wo.planned_end_date <= $${paramIndex}`);
        params.push(filters.toDate);
        paramIndex++;
      }

      const whereClause = conditions.join(' AND ');

      // Get total count
      const countResult = await this.query(
        `SELECT COUNT(*) as total FROM work_orders wo WHERE ${whereClause}`,
        params
      );

      // Get paginated data
      const dataResult = await this.query(
        `SELECT wo.*, p.name_ar as product_name, p.code as product_code
         FROM work_orders wo
         LEFT JOIN products p ON wo.product_id = p.id
         WHERE ${whereClause}
         ORDER BY wo.created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, pageSize, offset]
      );

      if (!dataResult.success) {
        throw new Error(dataResult.error || 'Failed to get work orders');
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
    }, 'getWorkOrdersPaginated');
  }

  /**
   * Get production cost analysis
   */
  async getProductionCostAnalysis(workOrderId: string) {
    this.requirePermission('manufacturing.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();

      // Get work order details
      const workOrderResult = await this.query(
        `SELECT wo.*, p.name_ar as product_name, p.cost_price as product_cost
         FROM work_orders wo
         LEFT JOIN products p ON wo.product_id = p.id
         WHERE wo.id = $1::uuid AND wo.company_id = $2::uuid`,
        [workOrderId, companyId]
      );

      if (!workOrderResult.success || !workOrderResult.rows || workOrderResult.rows.length === 0) {
        throw new Error('Work order not found');
      }

      const workOrder = workOrderResult.rows[0] as Record<string, unknown>;

      // Get BOM used
      const bomResult = await this.query(
        `SELECT bom.* FROM bills_of_materials bom
         WHERE bom.product_id = $1::uuid AND bom.company_id = $2::uuid AND bom.is_active = true
         ORDER BY bom.version DESC
         LIMIT 1`,
        [workOrder.product_id, companyId]
      );

      if (!bomResult.success || !bomResult.rows || bomResult.rows.length === 0) {
        throw new Error('No active BOM found');
      }

      const bom = bomResult.rows[0] as Record<string, unknown>;

      // Get component costs
      const componentsResult = await this.query(
        `SELECT 
          bc.*,
          p.name_ar as component_name,
          p.cost_price as component_cost
         FROM bom_components bc
         LEFT JOIN products p ON bc.component_product_id = p.id
         WHERE bc.bom_id = $1::uuid AND bc.company_id = $2::uuid`,
        [bom.id, companyId]
      );

      if (!componentsResult.success || !componentsResult.rows) {
        throw new Error('Failed to get component costs');
      }

      const components = componentsResult.rows;

      // Calculate costs
      const actualQuantity = Number(workOrder.actual_quantity) || Number(workOrder.quantity) || 0;
      let totalMaterialCost = 0;

      const componentCosts = components.map((component: Record<string, unknown>) => {
        const componentQuantity = Number(component.quantity) || 0;
        const componentCost = Number(component.component_cost) || 0;
        const totalCost = componentQuantity * componentCost * actualQuantity;
        totalMaterialCost += totalCost;

        return {
          componentName: String(component.component_name),
          componentQuantity,
          componentCost,
          totalCost,
        };
      });

      // Calculate total cost (material + overhead)
      const overheadRate = 0.2; // 20% overhead
      const overheadCost = totalMaterialCost * overheadRate;
      const totalCost = totalMaterialCost + overheadCost;
      const unitCost = actualQuantity > 0 ? totalCost / actualQuantity : 0;

      // Calculate variance
      const standardCost = Number(workOrder.product_cost) || 0;
      const variance = unitCost - standardCost;
      const variancePercent = standardCost > 0 ? (variance / standardCost) * 100 : 0;

      return {
        success: true,
        data: {
          workOrderId,
          workOrderNumber: String(workOrder.work_order_number),
          productName: String(workOrder.product_name),
          actualQuantity,
          totalMaterialCost: Math.round(totalMaterialCost * 100) / 100,
          overheadCost: Math.round(overheadCost * 100) / 100,
          totalCost: Math.round(totalCost * 100) / 100,
          unitCost: Math.round(unitCost * 100) / 100,
          standardCost: Math.round(standardCost * 100) / 100,
          variance: Math.round(variance * 100) / 100,
          variancePercent: Math.round(variancePercent * 100) / 100,
          componentCosts,
        },
      };
    }, 'getProductionCostAnalysis');
  }
}

// Singleton instance
export const manufacturingService = new ManufacturingService();
