import { BaseService } from '@/core/services/BaseService';
import { z } from 'zod';

// Validation schemas
const CreateLeadSchema = z.object({
  contactName: z.string().min(1),
  companyName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  source: z.enum(['website', 'referral', 'social_media', 'advertisement', 'event', 'other']).default('other'),
  status: z.enum(['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost']).default('new'),
  estimatedValue: z.number().min(0).default(0),
  probability: z.number().min(0).max(100).default(0),
  expectedCloseDate: z.string().optional(),
  assignedTo: z.string().uuid().optional(),
  notes: z.string().optional(),
});

const CreateTaskSchema = z.object({
  leadId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).default('pending'),
  assignedTo: z.string().uuid().optional(),
});

const CreateCallSchema = z.object({
  leadId: z.string().uuid(),
  callDate: z.string(),
  duration: z.number().min(0).default(0),
  direction: z.enum(['inbound', 'outbound']).default('outbound'),
  notes: z.string().optional(),
  outcome: z.enum(['successful', 'unsuccessful', 'voicemail', 'callback_requested']).optional(),
});

export type CreateLeadDto = z.infer<typeof CreateLeadSchema>;
export type CreateTaskDto = z.infer<typeof CreateTaskSchema>;
export type CreateCallDto = z.infer<typeof CreateCallSchema>;

/**
 * CRM Service
 * 
 * Encapsulates all business logic for CRM operations:
 * - Lead management
 * - Task management
 * - Call tracking
 * - Opportunity pipeline
 * - Customer relationship tracking
 */
export class CRMService extends BaseService {
  /**
   * Create a new lead
   */
  async createLead(data: CreateLeadDto) {
    this.requirePermission('crm.create');

    return this.executeWithErrorHandling(async () => {
      const validated = CreateLeadSchema.parse(data);
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();

      // Create lead
      const result = await this.query(
        `INSERT INTO leads 
         (id, company_id, contact_name, company_name, email, phone, source, status, 
          estimated_value, probability, expected_close_date, assigned_to, notes, created_by)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid, $13, $14::uuid)
         RETURNING id`,
        [
          crypto.randomUUID(),
          companyId,
          validated.contactName,
          validated.companyName || null,
          validated.email || null,
          validated.phone || null,
          validated.source,
          validated.status,
          validated.estimatedValue,
          validated.probability,
          validated.expectedCloseDate || null,
          validated.assignedTo || null,
          validated.notes || null,
          userId,
        ]
      );

      if (!result.success || !result.rows || result.rows.length === 0) {
        throw new Error(result.error || 'Failed to create lead');
      }

      const leadId = String(result.rows[0].id);

      // Audit log
      await this.auditLog({
        tableName: 'leads',
        recordId: leadId,
        action: 'create',
        newValues: {
          contactName: validated.contactName,
          status: validated.status,
          estimatedValue: validated.estimatedValue,
        },
      });

      return { success: true, id: leadId };
    }, 'createLead');
  }

  /**
   * Update lead status
   */
  async updateLeadStatus(leadId: string, newStatus: 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost') {
    this.requirePermission('crm.edit');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();

      // Get current status
      const currentResult = await this.query(
        'SELECT status FROM leads WHERE id = $1::uuid AND company_id = $2::uuid',
        [leadId, companyId]
      );

      if (!currentResult.success || !currentResult.rows || currentResult.rows.length === 0) {
        throw new Error('Lead not found');
      }

      const currentStatus = String(currentResult.rows[0].status);

      // Update status
      const result = await this.query(
        `UPDATE leads 
         SET status = $1, updated_by = $2::uuid, updated_at = NOW()
         WHERE id = $3::uuid AND company_id = $4::uuid`,
        [newStatus, userId, leadId, companyId]
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to update lead status');
      }

      // Audit log
      await this.auditLog({
        tableName: 'leads',
        recordId: leadId,
        action: 'update',
        oldValues: { status: currentStatus },
        newValues: { status: newStatus },
      });

      return { success: true };
    }, 'updateLeadStatus');
  }

  /**
   * Create a task
   */
  async createTask(data: CreateTaskDto) {
    this.requirePermission('crm.edit');

    return this.executeWithErrorHandling(async () => {
      const validated = CreateTaskSchema.parse(data);
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();

      // Verify lead exists
      const leadResult = await this.query(
        'SELECT id FROM leads WHERE id = $1::uuid AND company_id = $2::uuid',
        [data.leadId, companyId]
      );

      if (!leadResult.success || !leadResult.rows || leadResult.rows.length === 0) {
        throw new Error('Lead not found');
      }

      // Create task
      const result = await this.query(
        `INSERT INTO tasks 
         (id, company_id, lead_id, title, description, due_date, priority, status, assigned_to, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::uuid, $10::uuid)
         RETURNING id`,
        [
          crypto.randomUUID(),
          companyId,
          validated.leadId,
          validated.title,
          validated.description || null,
          validated.dueDate || null,
          validated.priority,
          validated.status,
          validated.assignedTo || null,
          userId,
        ]
      );

      if (!result.success || !result.rows || result.rows.length === 0) {
        throw new Error(result.error || 'Failed to create task');
      }

      const taskId = String(result.rows[0].id);

      // Audit log
      await this.auditLog({
        tableName: 'tasks',
        recordId: taskId,
        action: 'create',
        newValues: {
          leadId: validated.leadId,
          title: validated.title,
          priority: validated.priority,
        },
      });

      return { success: true, id: taskId };
    }, 'createTask');
  }

  /**
   * Record a call
   */
  async createCall(data: CreateCallDto) {
    this.requirePermission('crm.edit');

    return this.executeWithErrorHandling(async () => {
      const validated = CreateCallSchema.parse(data);
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();

      // Verify lead exists
      const leadResult = await this.query(
        'SELECT id FROM leads WHERE id = $1::uuid AND company_id = $2::uuid',
        [data.leadId, companyId]
      );

      if (!leadResult.success || !leadResult.rows || leadResult.rows.length === 0) {
        throw new Error('Lead not found');
      }

      // Create call record
      const result = await this.query(
        `INSERT INTO calls 
         (id, company_id, lead_id, call_date, duration, direction, notes, outcome, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::uuid)
         RETURNING id`,
        [
          crypto.randomUUID(),
          companyId,
          validated.leadId,
          validated.callDate,
          validated.duration,
          validated.direction,
          validated.notes || null,
          validated.outcome || null,
          userId,
        ]
      );

      if (!result.success || !result.rows || result.rows.length === 0) {
        throw new Error(result.error || 'Failed to create call record');
      }

      const callId = String(result.rows[0].id);

      // Audit log
      await this.auditLog({
        tableName: 'calls',
        recordId: callId,
        action: 'create',
        newValues: {
          leadId: validated.leadId,
          callDate: validated.callDate,
          direction: validated.direction,
        },
      });

      return { success: true, id: callId };
    }, 'createCall');
  }

  /**
   * Get sales funnel/pipeline data
   */
  async getSalesFunnel(fromDate?: string, toDate?: string) {
    this.requirePermission('crm.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();

      const conditions: string[] = ['company_id = $1::uuid'];
      const params: unknown[] = [companyId];
      let paramIndex = 2;

      if (fromDate) {
        conditions.push(`created_at >= $${paramIndex}`);
        params.push(fromDate);
        paramIndex++;
      }

      if (toDate) {
        conditions.push(`created_at <= $${paramIndex}`);
        params.push(toDate);
      }

      const whereClause = conditions.join(' AND ');

      // Get leads by status
      const result = await this.query(
        `SELECT 
          status,
          COUNT(*) as count,
          SUM(estimated_value) as total_value,
          AVG(probability) as avg_probability
         FROM leads
         WHERE ${whereClause}
         GROUP BY status
         ORDER BY 
           CASE status
             WHEN 'new' THEN 1
             WHEN 'contacted' THEN 2
             WHEN 'qualified' THEN 3
             WHEN 'proposal' THEN 4
             WHEN 'negotiation' THEN 5
             WHEN 'closed_won' THEN 6
             WHEN 'closed_lost' THEN 7
           END`,
        params
      );

      if (!result.success) {
        throw new Error(result.error || 'Failed to get sales funnel');
      }

      const funnel = (result.rows || []).map((row: Record<string, unknown>) => ({
        status: String(row.status),
        count: Number(row.count) || 0,
        totalValue: Number(row.total_value) || 0,
        avgProbability: Number(row.avg_probability) || 0,
      }));

      // Calculate conversion rates
      const totalLeads = funnel.reduce((sum: number, stage) => sum + stage.count, 0);
      const funnelWithRates = funnel.map((stage, index) => {
        const previousStages = funnel.slice(0, index);
        const previousTotal = previousStages.reduce((sum: number, s) => sum + s.count, 0);
        const conversionRate = previousTotal > 0 ? (stage.count / previousTotal) * 100 : 0;

        return {
          ...stage,
          conversionRate: Math.round(conversionRate * 100) / 100,
        };
      });

      return {
        success: true,
        data: {
          funnel: funnelWithRates,
          totalLeads,
          totalValue: funnel.reduce((sum: number, stage) => sum + stage.totalValue, 0),
          wonDeals: funnel.find(f => f.status === 'closed_won')?.count || 0,
          lostDeals: funnel.find(f => f.status === 'closed_lost')?.count || 0,
        },
      };
    }, 'getSalesFunnel');
  }

  /**
   * Get leads with pagination
   */
  async getLeadsPaginated(page: number, pageSize: number, filters?: {
    status?: string;
    assignedTo?: string;
    source?: string;
    search?: string;
  }) {
    this.requirePermission('crm.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      const offset = (page - 1) * pageSize;

      const conditions: string[] = ['l.company_id = $1::uuid'];
      const params: unknown[] = [companyId];
      let paramIndex = 2;

      if (filters?.status) {
        conditions.push(`l.status = $${paramIndex}`);
        params.push(filters.status);
        paramIndex++;
      }

      if (filters?.assignedTo) {
        conditions.push(`l.assigned_to = $${paramIndex}::uuid`);
        params.push(filters.assignedTo);
        paramIndex++;
      }

      if (filters?.source) {
        conditions.push(`l.source = $${paramIndex}`);
        params.push(filters.source);
        paramIndex++;
      }

      if (filters?.search) {
        conditions.push(`(l.contact_name ILIKE $${paramIndex} OR l.company_name ILIKE $${paramIndex} OR l.email ILIKE $${paramIndex})`);
        params.push(`%${filters.search}%`);
        paramIndex++;
      }

      const whereClause = conditions.join(' AND ');

      // Get total count
      const countResult = await this.query(
        `SELECT COUNT(*) as total FROM leads l WHERE ${whereClause}`,
        params
      );

      // Get paginated data
      const dataResult = await this.query(
        `SELECT l.*, u.full_name as assigned_to_name 
         FROM leads l 
         LEFT JOIN users u ON l.assigned_to = u.id 
         WHERE ${whereClause}
         ORDER BY l.created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, pageSize, offset]
      );

      if (!dataResult.success) {
        throw new Error(dataResult.error || 'Failed to get leads');
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
    }, 'getLeadsPaginated');
  }

  /**
   * Get tasks with pagination
   */
  async getTasksPaginated(page: number, pageSize: number, filters?: {
    status?: string;
    assignedTo?: string;
    priority?: string;
    leadId?: string;
  }) {
    this.requirePermission('crm.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      const offset = (page - 1) * pageSize;

      const conditions: string[] = ['t.company_id = $1::uuid'];
      const params: unknown[] = [companyId];
      let paramIndex = 2;

      if (filters?.status) {
        conditions.push(`t.status = $${paramIndex}`);
        params.push(filters.status);
        paramIndex++;
      }

      if (filters?.assignedTo) {
        conditions.push(`t.assigned_to = $${paramIndex}::uuid`);
        params.push(filters.assignedTo);
        paramIndex++;
      }

      if (filters?.priority) {
        conditions.push(`t.priority = $${paramIndex}`);
        params.push(filters.priority);
        paramIndex++;
      }

      if (filters?.leadId) {
        conditions.push(`t.lead_id = $${paramIndex}::uuid`);
        params.push(filters.leadId);
        paramIndex++;
      }

      const whereClause = conditions.join(' AND ');

      // Get total count
      const countResult = await this.query(
        `SELECT COUNT(*) as total FROM tasks t WHERE ${whereClause}`,
        params
      );

      // Get paginated data
      const dataResult = await this.query(
        `SELECT t.*, l.contact_name as lead_contact_name, l.company_name as lead_company_name,
                u.full_name as assigned_to_name
         FROM tasks t
         LEFT JOIN leads l ON t.lead_id = l.id
         LEFT JOIN users u ON t.assigned_to = u.id
         WHERE ${whereClause}
         ORDER BY t.due_date ASC, t.created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, pageSize, offset]
      );

      if (!dataResult.success) {
        throw new Error(dataResult.error || 'Failed to get tasks');
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
    }, 'getTasksPaginated');
  }
}

// Singleton instance
export const crmService = new CRMService();
