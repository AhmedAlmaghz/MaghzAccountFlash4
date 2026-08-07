import { BaseService } from '@/core/services/BaseService';
import { z } from 'zod';

// Validation schemas
const CreateInvoiceSchema = z.object({
  customerId: z.string().uuid(),
  date: z.string(),
  dueDate: z.string().optional(),
  currencyCode: z.string().default('YER'),
  exchangeRate: z.number().default(1),
  lines: z.array(z.object({
    productId: z.string().uuid(),
    quantity: z.number().positive(),
    unitPrice: z.number().positive(),
    discount: z.number().min(0).default(0),
    vatRate: z.number().min(0).default(0),
  })).min(1),
  notes: z.string().optional(),
  paymentType: z.enum(['cash', 'credit', 'partial']).default('credit'),
  paidAmount: z.number().min(0).default(0),
});

const PostInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
});

export type CreateInvoiceDto = z.infer<typeof CreateInvoiceSchema>;
export type PostInvoiceDto = z.infer<typeof PostInvoiceSchema>;

/**
 * Sales Service
 * 
 * Encapsulates all business logic for sales operations:
 * - Invoice creation and posting
 * - Customer management
 * - Sales reporting
 * - VAT calculation
 * - Payment tracking
 */
export class SalesService extends BaseService {
  /**
   * Create a new sales invoice (draft)
   */
  async createInvoice(data: CreateInvoiceDto) {
    this.requirePermission('sales.create');

    return this.executeWithErrorHandling(async () => {
      const validated = CreateInvoiceSchema.parse(data);
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();

      // Calculate totals
      let subtotal = 0;
      let totalVat = 0;

      for (const line of validated.lines) {
        const lineTotal = line.quantity * line.unitPrice * (1 - line.discount / 100);
        const lineVat = lineTotal * (line.vatRate / 100);
        subtotal += lineTotal;
        totalVat += lineVat;
      }

      const totalAmount = subtotal + totalVat;
      const baseCurrencyAmount = totalAmount * validated.exchangeRate;
      const baseCurrencyPaid = validated.paidAmount * validated.exchangeRate;

      // Generate invoice number
      const invoiceNumber = await this.generateInvoiceNumber(companyId);

      // Create invoice
      const invoiceResult = await this.query(
        `INSERT INTO sales_invoices 
         (id, company_id, customer_id, invoice_number, date, due_date, currency_code, exchange_rate, 
          subtotal, vat_amount, total_amount, paid_amount, base_currency_amount, base_currency_paid, 
          status, payment_type, notes, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'draft', $15, $16, $17::uuid)
         RETURNING id`,
        [
          crypto.randomUUID(),
          companyId,
          validated.customerId,
          invoiceNumber,
          validated.date,
          validated.dueDate || null,
          validated.currencyCode,
          validated.exchangeRate,
          subtotal,
          totalVat,
          totalAmount,
          validated.paidAmount,
          baseCurrencyAmount,
          baseCurrencyPaid,
          validated.paymentType,
          validated.notes || null,
          userId,
        ]
      );

      if (!invoiceResult.success || !invoiceResult.rows || invoiceResult.rows.length === 0) {
        throw new Error(invoiceResult.error || 'Failed to create invoice');
      }

      const invoiceId = String(invoiceResult.rows[0].id);

      // Create invoice lines
      for (const line of validated.lines) {
        const lineTotal = line.quantity * line.unitPrice * (1 - line.discount / 100);
        const lineVat = lineTotal * (line.vatRate / 100);

        await this.query(
          `INSERT INTO sales_invoice_lines 
           (id, invoice_id, product_id, quantity, unit_price, discount, vat_rate, line_total, vat_amount, company_id)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10::uuid)`,
          [
            crypto.randomUUID(),
            invoiceId,
            line.productId,
            line.quantity,
            line.unitPrice,
            line.discount,
            line.vatRate,
            lineTotal,
            lineVat,
            companyId,
          ]
        );
      }

      // Audit log
      await this.auditLog({
        tableName: 'sales_invoices',
        recordId: invoiceId,
        action: 'create',
        newValues: {
          invoiceNumber,
          customerId: validated.customerId,
          totalAmount,
          status: 'draft',
        },
      });

      return { success: true, id: invoiceId, invoiceNumber };
    }, 'createInvoice');
  }

  /**
   * Post a sales invoice
   * 
   * This is a critical operation that:
   * 1. Validates the invoice
   * 2. Creates accounting entries (debit A/R, credit Revenue, debit/credit VAT)
   * 3. Updates inventory (if applicable)
   * 4. Updates customer balance
   * 5. Changes status to 'posted'
   * 6. Is performed atomically (transaction-safe)
   */
  async postInvoice(data: PostInvoiceDto) {
    this.requirePermission('sales.post');

    return this.executeWithErrorHandling(async () => {
      const validated = PostInvoiceSchema.parse(data);
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();

      // Get invoice details
      const invoiceResult = await this.query(
        `SELECT * FROM sales_invoices 
         WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft'`,
        [validated.invoiceId, companyId]
      );

      if (!invoiceResult.success || !invoiceResult.rows || invoiceResult.rows.length === 0) {
        throw new Error('Invoice not found or already posted');
      }

      const invoice = invoiceResult.rows[0] as Record<string, unknown>;

      // Get invoice lines
      const linesResult = await this.query(
        `SELECT * FROM sales_invoice_lines 
         WHERE invoice_id = $1::uuid AND company_id = $2::uuid`,
        [validated.invoiceId, companyId]
      );

      if (!linesResult.success || !linesResult.rows) {
        throw new Error('Failed to get invoice lines');
      }

      // Get or create default accounts for sales
      const accounts = await this.getSalesAccounts(companyId);

      // Build transaction queries
      const transactionId = crypto.randomUUID();
      const queries: { sql: string; params: unknown[] }[] = [
        // Create transaction
        {
          sql: `INSERT INTO transactions (id, company_id, date, description, reference, created_by, status)
                VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, 'posted')`,
          params: [
            transactionId,
            companyId,
            invoice.date,
            `Sales Invoice ${invoice.invoice_number}`,
            invoice.invoice_number,
            userId,
          ],
        },
      ];

      // Debit Accounts Receivable
      queries.push({
        sql: `INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit, company_id)
              VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)`,
        params: [
          crypto.randomUUID(),
          transactionId,
          accounts.receivableAccountId,
          invoice.total_amount,
          0,
          companyId,
        ],
      });

      // Credit Revenue (subtotal)
      queries.push({
        sql: `INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit, company_id)
              VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)`,
        params: [
          crypto.randomUUID(),
          transactionId,
          accounts.revenueAccountId,
          0,
          invoice.subtotal,
          companyId,
        ],
      });

      // Credit VAT Payable (VAT amount)
      if (invoice.vat_amount && Number(invoice.vat_amount) > 0) {
        queries.push({
          sql: `INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit, company_id)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)`,
          params: [
            crypto.randomUUID(),
            transactionId,
            accounts.vatAccountId,
            0,
            invoice.vat_amount,
            companyId,
          ],
        });
      }

      // Update invoice status
      queries.push({
        sql: `UPDATE sales_invoices 
              SET status = 'posted', posted_at = NOW(), posted_by = $1::uuid
              WHERE id = $2::uuid AND company_id = $3::uuid`,
        params: [userId, validated.invoiceId, companyId],
      });

      // Update customer balance
      queries.push({
        sql: `UPDATE customers 
              SET balance = balance + $1 
              WHERE id = $2::uuid AND company_id = $3::uuid`,
        params: [invoice.base_currency_amount, invoice.customer_id, companyId],
      });

      // Execute transaction atomically
      const result = await this.transaction(queries);

      if (!result.success) {
        throw new Error(result.error || 'Failed to post invoice');
      }

      // Audit log
      await this.auditLog({
        tableName: 'sales_invoices',
        recordId: validated.invoiceId,
        action: 'post',
        newValues: {
          invoiceNumber: invoice.invoice_number,
          totalAmount: invoice.total_amount,
          transactionId,
        },
      });

      return { success: true, transactionId };
    }, 'postInvoice');
  }

  /**
   * Get sales accounts (AR, Revenue, VAT)
   */
  private async getSalesAccounts(companyId: string) {
    const result = await this.query(
      `SELECT 
        (SELECT id FROM accounts WHERE company_id = $1::uuid AND code LIKE '11%' LIMIT 1) as receivable_account_id,
        (SELECT id FROM accounts WHERE company_id = $1::uuid AND code LIKE '4%' LIMIT 1) as revenue_account_id,
        (SELECT id FROM accounts WHERE company_id = $1::uuid AND code LIKE '22%' AND name_ar LIKE '%ضريبة%' LIMIT 1) as vat_account_id`,
      [companyId]
    );

    if (!result.success || !result.rows || result.rows.length === 0) {
      throw new Error('Failed to get sales accounts');
    }

    const accounts = result.rows[0] as Record<string, unknown>;

    if (!accounts.receivable_account_id || !accounts.revenue_account_id) {
      throw new Error('Required accounts not configured (AR or Revenue)');
    }

    return {
      receivableAccountId: String(accounts.receivable_account_id),
      revenueAccountId: String(accounts.revenue_account_id),
      vatAccountId: accounts.vat_account_id ? String(accounts.vat_account_id) : null,
    };
  }

  /**
   * Generate invoice number
   */
  private async generateInvoiceNumber(companyId: string): Promise<string> {
    const result = await this.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '\\d+$') AS INTEGER)), 0) + 1 as next_number
       FROM sales_invoices 
       WHERE company_id = $1::uuid 
       AND invoice_number ~ '^[A-Za-z]+\\d+$'`,
      [companyId]
    );

    if (!result.success || !result.rows || result.rows.length === 0) {
      // Fallback to timestamp-based number
      return `INV${Date.now()}`;
    }

    const nextNumber = result.rows[0].next_number as number;
    return `INV${String(nextNumber).padStart(6, '0')}`;
  }

  /**
   * Get invoices with pagination
   */
  async getInvoicesPaginated(page: number, pageSize: number, filters?: {
    status?: string;
    customerId?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    this.requirePermission('sales.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      const offset = (page - 1) * pageSize;

      const conditions: string[] = ['si.company_id = $1::uuid'];
      const params: unknown[] = [companyId];
      let paramIndex = 2;

      if (filters?.status) {
        conditions.push(`si.status = $${paramIndex}`);
        params.push(filters.status);
        paramIndex++;
      }

      if (filters?.customerId) {
        conditions.push(`si.customer_id = $${paramIndex}::uuid`);
        params.push(filters.customerId);
        paramIndex++;
      }

      if (filters?.fromDate) {
        conditions.push(`si.date >= $${paramIndex}`);
        params.push(filters.fromDate);
        paramIndex++;
      }

      if (filters?.toDate) {
        conditions.push(`si.date <= $${paramIndex}`);
        params.push(filters.toDate);
        paramIndex++;
      }

      const whereClause = conditions.join(' AND ');

      // Get total count
      const countResult = await this.query(
        `SELECT COUNT(*) as total FROM sales_invoices si WHERE ${whereClause}`,
        params
      );

      // Get paginated data
      const dataResult = await this.query(
        `SELECT si.*, c.name as customer_name 
         FROM sales_invoices si 
         LEFT JOIN customers c ON si.customer_id = c.id 
         WHERE ${whereClause}
         ORDER BY si.date DESC, si.created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, pageSize, offset]
      );

      if (!dataResult.success) {
        throw new Error(dataResult.error || 'Failed to get invoices');
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
    }, 'getInvoicesPaginated');
  }
}

// Singleton instance
export const salesService = new SalesService();
