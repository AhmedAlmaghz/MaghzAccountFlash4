import { BaseService } from '@/core/services/BaseService';
import { z } from 'zod';

// Validation schemas
const CreatePurchaseInvoiceSchema = z.object({
  supplierId: z.string().uuid(),
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

const PostPurchaseInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
});

export type CreatePurchaseInvoiceDto = z.infer<typeof CreatePurchaseInvoiceSchema>;
export type PostPurchaseInvoiceDto = z.infer<typeof PostPurchaseInvoiceSchema>;

/**
 * Purchasing Service
 * 
 * Encapsulates all business logic for purchasing operations:
 * - Purchase invoice creation and posting
 * - Supplier management
 * - Purchase order management
 * - VAT calculation
 * - Payment tracking
 */
export class PurchasingService extends BaseService {
  /**
   * Create a new purchase invoice (draft)
   */
  async createPurchaseInvoice(data: CreatePurchaseInvoiceDto) {
    this.requirePermission('purchases.create');

    return this.executeWithErrorHandling(async () => {
      const validated = CreatePurchaseInvoiceSchema.parse(data);
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
      const invoiceNumber = await this.generatePurchaseInvoiceNumber(companyId);

      // Create invoice
      const invoiceResult = await this.query(
        `INSERT INTO purchase_invoices 
         (id, company_id, supplier_id, invoice_number, date, due_date, currency_code, exchange_rate, 
          subtotal, discount_amount, vat_amount, total_amount, paid_amount, base_currency_amount, base_currency_paid, 
          status, payment_type, notes, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'draft', $16, $17, $18::uuid)
         RETURNING id`,
        [
          crypto.randomUUID(),
          companyId,
          validated.supplierId,
          invoiceNumber,
          validated.date,
          validated.dueDate || null,
          validated.currencyCode,
          validated.exchangeRate,
          subtotal,
          0, // discount_amount
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
        throw new Error(invoiceResult.error || 'Failed to create purchase invoice');
      }

      const invoiceId = String(invoiceResult.rows[0].id);

      // Create invoice lines
      for (const line of validated.lines) {
        const lineTotal = line.quantity * line.unitPrice * (1 - line.discount / 100);
        const lineVat = lineTotal * (line.vatRate / 100);

        await this.query(
          `INSERT INTO purchase_invoice_lines 
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
        tableName: 'purchase_invoices',
        recordId: invoiceId,
        action: 'create',
        newValues: {
          invoiceNumber,
          supplierId: validated.supplierId,
          totalAmount,
          status: 'draft',
        },
      });

      return { success: true, id: invoiceId, invoiceNumber };
    }, 'createPurchaseInvoice');
  }

  /**
   * Post a purchase invoice
   * 
   * This is a critical operation that:
   * 1. Validates the invoice
   * 2. Creates accounting entries (debit Inventory/Purchases, credit A/P, debit/credit VAT)
   * 3. Updates inventory (if applicable)
   * 4. Updates supplier balance
   * 5. Changes status to 'posted'
   * 6. Is performed atomically (transaction-safe)
   */
  async postPurchaseInvoice(data: PostPurchaseInvoiceDto) {
    this.requirePermission('purchases.post');

    return this.executeWithErrorHandling(async () => {
      const validated = PostPurchaseInvoiceSchema.parse(data);
      const companyId = this.getCompanyId();
      const userId = this.getCurrentUserId();

      // Get invoice details
      const invoiceResult = await this.query(
        `SELECT * FROM purchase_invoices 
         WHERE id = $1::uuid AND company_id = $2::uuid AND status = 'draft'`,
        [validated.invoiceId, companyId]
      );

      if (!invoiceResult.success || !invoiceResult.rows || invoiceResult.rows.length === 0) {
        throw new Error('Purchase invoice not found or already posted');
      }

      const invoice = invoiceResult.rows[0] as Record<string, unknown>;

      // Get invoice lines
      const linesResult = await this.query(
        `SELECT * FROM purchase_invoice_lines 
         WHERE invoice_id = $1::uuid AND company_id = $2::uuid`,
        [validated.invoiceId, companyId]
      );

      if (!linesResult.success || !linesResult.rows) {
        throw new Error('Failed to get purchase invoice lines');
      }

      // Get or create default accounts for purchases
      const accounts = await this.getPurchasingAccounts(companyId);

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
            `Purchase Invoice ${invoice.invoice_number}`,
            invoice.invoice_number,
            userId,
          ],
        },
      ];

      // Debit Purchases/Inventory (subtotal)
      queries.push({
        sql: `INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit, company_id)
              VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)`,
        params: [
          crypto.randomUUID(),
          transactionId,
          accounts.purchasesAccountId,
          invoice.subtotal,
          0,
          companyId,
        ],
      });

      // Credit Accounts Payable (total)
      queries.push({
        sql: `INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit, company_id)
              VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)`,
        params: [
          crypto.randomUUID(),
          transactionId,
          accounts.payableAccountId,
          0,
          invoice.total_amount,
          companyId,
        ],
      });

      // Debit VAT Receivable (VAT amount)
      if (invoice.vat_amount && Number(invoice.vat_amount) > 0) {
        queries.push({
          sql: `INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit, company_id)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)`,
          params: [
            crypto.randomUUID(),
            transactionId,
            accounts.vatAccountId,
            invoice.vat_amount,
            0,
            companyId,
          ],
        });
      }

      // Update invoice status
      queries.push({
        sql: `UPDATE purchase_invoices 
              SET status = 'posted', posted_at = NOW(), posted_by = $1::uuid
              WHERE id = $2::uuid AND company_id = $3::uuid`,
        params: [userId, validated.invoiceId, companyId],
      });

      // Update supplier balance
      queries.push({
        sql: `UPDATE suppliers 
              SET balance = balance + $1 
              WHERE id = $2::uuid AND company_id = $3::uuid`,
        params: [invoice.base_currency_amount, invoice.supplier_id, companyId],
      });

      // Execute transaction atomically
      const result = await this.transaction(queries);

      if (!result.success) {
        throw new Error(result.error || 'Failed to post purchase invoice');
      }

      // Audit log
      await this.auditLog({
        tableName: 'purchase_invoices',
        recordId: validated.invoiceId,
        action: 'post',
        newValues: {
          invoiceNumber: invoice.invoice_number,
          totalAmount: invoice.total_amount,
          transactionId,
        },
      });

      return { success: true, transactionId };
    }, 'postPurchaseInvoice');
  }

  /**
   * Get purchasing accounts (AP, Purchases, VAT)
   */
  private async getPurchasingAccounts(companyId: string) {
    const result = await this.query(
      `SELECT 
        (SELECT id FROM accounts WHERE company_id = $1::uuid AND code LIKE '21%' LIMIT 1) as payable_account_id,
        (SELECT id FROM accounts WHERE company_id = $1::uuid AND code LIKE '5%' LIMIT 1) as purchases_account_id,
        (SELECT id FROM accounts WHERE company_id = $1::uuid AND code LIKE '22%' AND name_ar LIKE '%ضريبة%' LIMIT 1) as vat_account_id`,
      [companyId]
    );

    if (!result.success || !result.rows || result.rows.length === 0) {
      throw new Error('Failed to get purchasing accounts');
    }

    const accounts = result.rows[0] as Record<string, unknown>;

    if (!accounts.payable_account_id || !accounts.purchases_account_id) {
      throw new Error('Required accounts not configured (AP or Purchases)');
    }

    return {
      payableAccountId: String(accounts.payable_account_id),
      purchasesAccountId: String(accounts.purchases_account_id),
      vatAccountId: accounts.vat_account_id ? String(accounts.vat_account_id) : null,
    };
  }

  /**
   * Generate purchase invoice number
   */
  private async generatePurchaseInvoiceNumber(companyId: string): Promise<string> {
    const result = await this.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '[0-9]+$') AS INTEGER)), 0) + 1 as next_number
       FROM purchase_invoices 
       WHERE company_id = $1::uuid 
       AND invoice_number ~ '^[A-Za-z]+[0-9]+$'`,
      [companyId]
    );

    if (!result.success || !result.rows || result.rows.length === 0) {
      // Fallback to timestamp-based number
      return `PINV${Date.now()}`;
    }

    const nextNumber = result.rows[0].next_number as number;
    return `PINV${String(nextNumber).padStart(6, '0')}`;
  }

  /**
   * Get purchase invoices with pagination
   */
  async getPurchaseInvoicesPaginated(page: number, pageSize: number, filters?: {
    status?: string;
    supplierId?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    this.requirePermission('purchases.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      const offset = (page - 1) * pageSize;

      const conditions: string[] = ['pi.company_id = $1::uuid'];
      const params: unknown[] = [companyId];
      let paramIndex = 2;

      if (filters?.status) {
        conditions.push(`pi.status = $${paramIndex}`);
        params.push(filters.status);
        paramIndex++;
      }

      if (filters?.supplierId) {
        conditions.push(`pi.supplier_id = $${paramIndex}::uuid`);
        params.push(filters.supplierId);
        paramIndex++;
      }

      if (filters?.fromDate) {
        conditions.push(`pi.date >= $${paramIndex}`);
        params.push(filters.fromDate);
        paramIndex++;
      }

      if (filters?.toDate) {
        conditions.push(`pi.date <= $${paramIndex}`);
        params.push(filters.toDate);
        paramIndex++;
      }

      const whereClause = conditions.join(' AND ');

      // Get total count
      const countResult = await this.query(
        `SELECT COUNT(*) as total FROM purchase_invoices pi WHERE ${whereClause}`,
        params
      );

      // Get paginated data
      const dataResult = await this.query(
        `SELECT pi.*, s.name as supplier_name 
         FROM purchase_invoices pi 
         LEFT JOIN suppliers s ON pi.supplier_id = s.id 
         WHERE ${whereClause}
         ORDER BY pi.date DESC, pi.created_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, pageSize, offset]
      );

      if (!dataResult.success) {
        throw new Error(dataResult.error || 'Failed to get purchase invoices');
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
    }, 'getPurchaseInvoicesPaginated');
  }

  /**
   * Get suppliers with pagination
   */
  async getSuppliersPaginated(page: number, pageSize: number, filters?: {
    isActive?: boolean;
    search?: string;
  }) {
    this.requirePermission('purchases.view');

    return this.executeWithErrorHandling(async () => {
      const companyId = this.getCompanyId();
      const offset = (page - 1) * pageSize;

      const conditions: string[] = ['s.company_id = $1::uuid'];
      const params: unknown[] = [companyId];
      let paramIndex = 2;

      if (filters?.isActive !== undefined) {
        conditions.push(`s.is_active = $${paramIndex}`);
        params.push(filters.isActive);
        paramIndex++;
      }

      if (filters?.search) {
        conditions.push(`(s.name ILIKE $${paramIndex} OR s.phone ILIKE $${paramIndex} OR s.code ILIKE $${paramIndex})`);
        params.push(`%${filters.search}%`);
        paramIndex++;
      }

      const whereClause = conditions.join(' AND ');

      // Get total count
      const countResult = await this.query(
        `SELECT COUNT(*) as total FROM suppliers s WHERE ${whereClause}`,
        params
      );

      // Get paginated data
      const dataResult = await this.query(
        `SELECT s.* FROM suppliers s 
         WHERE ${whereClause}
         ORDER BY s.name ASC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, pageSize, offset]
      );

      if (!dataResult.success) {
        throw new Error(dataResult.error || 'Failed to get suppliers');
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
    }, 'getSuppliersPaginated');
  }
}

// Singleton instance
export const purchasingService = new PurchasingService();
