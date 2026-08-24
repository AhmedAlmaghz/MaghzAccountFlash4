import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const companyIdSchema = z.string().uuid().min(1);
export const userIdSchema = z.string().uuid().min(1);

export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(50),
});

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)');

export const currencyAmountSchema = z.number().min(0).multipleOf(0.0001);

export const percentageSchema = z.number().min(0).max(100).multipleOf(0.01);

export const nonEmptyString = z.string().min(1).max(255);

export const emailSchema = z.string().email().optional().or(z.literal(''));

export const phoneSchema = z.string().max(50).optional().or(z.literal(''));

export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  const errors = result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
  return { success: false, error: errors };
}

export const idCompanySchema = z.object({
  id: uuidSchema,
  companyId: companyIdSchema,
});

export const createAccountSchema = z.object({
  companyId: companyIdSchema,
  code: z.string().min(1).max(20),
  nameAr: z.string().min(1).max(255),
  nameEn: z.string().max(255).optional(),
  parentId: uuidSchema.optional(),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  nature: z.enum(['debit', 'credit']),
  isGroup: z.boolean().default(false),
  balance: currencyAmountSchema.default(0),
  isActive: z.boolean().default(true),
});

export const createTransactionSchema = z.object({
  companyId: companyIdSchema,
  date: dateSchema,
  reference: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  totalAmount: currencyAmountSchema,
  status: z.enum(['draft', 'posted', 'cancelled']).default('draft'),
  entries: z.array(z.object({
    accountId: uuidSchema,
    debit: currencyAmountSchema,
    credit: currencyAmountSchema,
    memo: z.string().max(500).optional(),
  })).min(1),
});

export const createReceiptVoucherSchema = z.object({
  companyId: companyIdSchema,
  voucherNumber: nonEmptyString,
  date: dateSchema,
  customerId: uuidSchema,
  invoiceId: uuidSchema.optional(),
  amount: currencyAmountSchema,
  amountApplied: currencyAmountSchema.optional(),
  paymentMethod: z.string().max(50),
  bankAccountId: uuidSchema.optional(),
  cashBoxId: uuidSchema.optional(),
  checkNumber: z.string().max(50).optional(),
  checkDate: dateSchema.optional(),
  notes: z.string().max(2000).optional(),
  currencyCode: z.string().length(3).optional(),
  exchangeRate: currencyAmountSchema.optional(),
  baseCurrencyAmount: currencyAmountSchema.optional(),
  baseCurrencyApplied: currencyAmountSchema.optional(),
  status: z.enum(['draft', 'posted', 'cancelled']).default('draft'),
});

export const createPaymentVoucherSchema = z.object({
  companyId: companyIdSchema,
  voucherNumber: nonEmptyString,
  date: dateSchema,
  supplierId: uuidSchema.optional(),
  invoiceId: uuidSchema.optional(),
  expenseAccountId: uuidSchema.optional(),
  amount: currencyAmountSchema,
  amountApplied: currencyAmountSchema.optional(),
  paymentMethod: z.string().max(50),
  bankAccountId: uuidSchema.optional(),
  cashBoxId: uuidSchema.optional(),
  checkNumber: z.string().max(50).optional(),
  checkDate: dateSchema.optional(),
  notes: z.string().max(2000).optional(),
  currencyCode: z.string().length(3).optional(),
  exchangeRate: currencyAmountSchema.optional(),
  baseCurrencyAmount: currencyAmountSchema.optional(),
  baseCurrencyApplied: currencyAmountSchema.optional(),
  status: z.enum(['draft', 'posted', 'cancelled']).default('draft'),
});

export const createCustomerSchema = z.object({
  companyId: companyIdSchema,
  code: z.string().max(50).optional(),
  name: nonEmptyString,
  phone: phoneSchema,
  email: emailSchema,
  address: z.string().max(1000).optional(),
  taxNumber: z.string().max(50).optional(),
  creditLimit: currencyAmountSchema.optional(),
  balance: currencyAmountSchema.default(0),
  openingBalance: currencyAmountSchema.optional(),
  openingBalancePosted: z.boolean().optional(),
  isActive: z.boolean().default(true),
});

export const createInvoiceSchema = z.object({
  companyId: companyIdSchema,
  invoiceNumber: nonEmptyString,
  customerId: uuidSchema,
  date: dateSchema,
  dueDate: dateSchema.optional(),
  subtotal: currencyAmountSchema,
  discountAmount: currencyAmountSchema.optional(),
  vatAmount: currencyAmountSchema.optional(),
  totalAmount: currencyAmountSchema,
  paidAmount: currencyAmountSchema.optional(),
  currencyCode: z.string().length(3).optional(),
  exchangeRate: currencyAmountSchema.optional(),
  baseCurrencyAmount: currencyAmountSchema.optional(),
  baseCurrencyPaid: currencyAmountSchema.optional(),
  paymentType: z.enum(['cash', 'credit']).optional(),
  cashBoxId: uuidSchema.optional(),
  bankAccountId: uuidSchema.optional(),
  status: z.enum(['draft', 'posted', 'paid', 'partially_paid', 'cancelled']).default('draft'),
  notes: z.string().max(2000).optional(),
  lines: z.array(z.object({
    productId: uuidSchema,
    quantity: currencyAmountSchema,
    unitPrice: currencyAmountSchema,
    discountPercent: percentageSchema.optional(),
    vatPercent: percentageSchema.optional(),
    lineTotal: currencyAmountSchema,
    currencyCode: z.string().length(3).optional(),
    exchangeRate: currencyAmountSchema.optional(),
    baseCurrencyLineTotal: currencyAmountSchema.optional(),
  })).min(1),
});

export const createQuotationSchema = z.object({
  companyId: companyIdSchema,
  quotationNumber: nonEmptyString,
  customerId: uuidSchema,
  date: dateSchema,
  expiryDate: dateSchema.optional(),
  totalAmount: currencyAmountSchema,
  paymentType: z.enum(['cash', 'credit']).optional(),
  cashBoxId: uuidSchema.optional(),
  bankAccountId: uuidSchema.optional(),
  status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'converted']).default('draft'),
  notes: z.string().max(2000).optional(),
  lines: z.array(z.object({
    productId: uuidSchema,
    quantity: currencyAmountSchema,
    unitPrice: currencyAmountSchema,
    discountPercent: percentageSchema.optional(),
    lineTotal: currencyAmountSchema,
  })).min(1),
});

export const createSalesReturnSchema = z.object({
  companyId: companyIdSchema,
  returnNumber: nonEmptyString,
  invoiceId: uuidSchema.optional(),
  customerId: uuidSchema,
  date: dateSchema,
  subtotal: currencyAmountSchema,
  vatAmount: currencyAmountSchema.optional(),
  totalAmount: currencyAmountSchema,
  reason: z.string().max(1000).optional(),
  paymentType: z.enum(['cash', 'credit']).optional(),
  cashBoxId: uuidSchema.optional(),
  bankAccountId: uuidSchema.optional(),
  status: z.enum(['draft', 'posted', 'cancelled']).default('draft'),
  notes: z.string().max(2000).optional(),
  lines: z.array(z.object({
    productId: uuidSchema,
    quantity: currencyAmountSchema,
    unitPrice: currencyAmountSchema,
    lineTotal: currencyAmountSchema,
  })).min(1),
});

export const createSupplierSchema = z.object({
  companyId: companyIdSchema,
  code: z.string().max(50).optional(),
  name: nonEmptyString,
  phone: phoneSchema,
  email: emailSchema,
  address: z.string().max(1000).optional(),
  taxNumber: z.string().max(50).optional(),
  balance: currencyAmountSchema.default(0),
  openingBalance: currencyAmountSchema.optional(),
  openingBalancePosted: z.boolean().optional(),
  isActive: z.boolean().default(true),
});

export const createPurchaseInvoiceSchema = z.object({
  companyId: companyIdSchema,
  invoiceNumber: nonEmptyString,
  supplierId: uuidSchema,
  purchaseOrderId: uuidSchema.optional(),
  date: dateSchema,
  dueDate: dateSchema.optional(),
  subtotal: currencyAmountSchema,
  discountAmount: currencyAmountSchema.optional(),
  vatAmount: currencyAmountSchema.optional(),
  totalAmount: currencyAmountSchema,
  paidAmount: currencyAmountSchema.optional(),
  currencyCode: z.string().length(3).optional(),
  exchangeRate: currencyAmountSchema.optional(),
  baseCurrencyAmount: currencyAmountSchema.optional(),
  baseCurrencyPaid: currencyAmountSchema.optional(),
  paymentType: z.enum(['cash', 'credit']).optional(),
  cashBoxId: uuidSchema.optional(),
  bankAccountId: uuidSchema.optional(),
  status: z.enum(['draft', 'posted', 'paid', 'partially_paid', 'cancelled']).default('draft'),
  notes: z.string().max(2000).optional(),
  lines: z.array(z.object({
    productId: uuidSchema.optional(),
    description: z.string().max(1000).optional(),
    quantity: currencyAmountSchema,
    unitPrice: currencyAmountSchema,
    discountPercent: z.number().min(0).max(100).optional().default(0),
    vatPercent: z.number().min(0).max(100).optional().default(0),
    lineTotal: currencyAmountSchema,
    currencyCode: z.string().length(3).optional(),
    exchangeRate: currencyAmountSchema.optional(),
    baseCurrencyLineTotal: currencyAmountSchema.optional(),
  })).min(1),
});

export const createPurchaseOrderSchema = z.object({
  companyId: companyIdSchema,
  orderNumber: nonEmptyString,
  supplierId: uuidSchema,
  date: dateSchema,
  expectedDate: dateSchema.optional(),
  totalAmount: currencyAmountSchema,
  paymentType: z.enum(['cash', 'credit']).optional(),
  cashBoxId: uuidSchema.optional(),
  bankAccountId: uuidSchema.optional(),
  status: z.enum(['draft', 'sent', 'confirmed', 'received', 'invoiced', 'cancelled']).default('draft'),
  notes: z.string().max(2000).optional(),
  lines: z.array(z.object({
    productId: uuidSchema.optional(),
    description: z.string().max(1000).optional(),
    quantity: currencyAmountSchema,
    unitPrice: currencyAmountSchema,
    lineTotal: currencyAmountSchema,
    receivedQuantity: currencyAmountSchema.optional(),
  })).optional(),
});

export const createPurchaseReturnSchema = z.object({
  companyId: companyIdSchema,
  returnNumber: nonEmptyString,
  invoiceId: uuidSchema.optional(),
  supplierId: uuidSchema,
  date: dateSchema,
  subtotal: currencyAmountSchema,
  vatAmount: currencyAmountSchema.optional(),
  totalAmount: currencyAmountSchema,
  paymentType: z.enum(['cash', 'credit']).optional(),
  cashBoxId: uuidSchema.optional(),
  bankAccountId: uuidSchema.optional(),
  status: z.enum(['draft', 'posted', 'cancelled']).default('draft'),
  notes: z.string().max(2000).optional(),
  reason: z.string().max(1000).optional(),
  lines: z.array(z.object({
    productId: uuidSchema.optional(),
    description: z.string().max(1000).optional(),
    quantity: currencyAmountSchema,
    unitPrice: currencyAmountSchema,
    lineTotal: currencyAmountSchema,
  })).min(1),
});

export const createProductSchema = z.object({
  companyId: companyIdSchema,
  code: z.string().min(1).max(50),
  nameAr: nonEmptyString,
  nameEn: z.string().max(255).optional(),
  barcode: z.string().max(100).optional(),
  sku: z.string().max(100).optional(),
  unit: z.string().max(50).default('piece'),
  categoryId: uuidSchema.optional(),
  categoryIds: z.array(uuidSchema).optional(),
  productTypeId: uuidSchema.optional(),
  costPrice: currencyAmountSchema,
  salePrice: currencyAmountSchema,
  isActive: z.boolean().default(true),
  image: z.string().optional(),
  minStock: currencyAmountSchema.optional(),
  maxStock: currencyAmountSchema.optional(),
  reorderPoint: currencyAmountSchema.optional(),
  openingStockQty: currencyAmountSchema.optional(),
  openingWarehouseId: uuidSchema.nullable().optional(),
  openingStockPosted: z.boolean().optional(),
  createdBy: uuidSchema.optional(),
  updatedBy: uuidSchema.optional(),
});

export const createWarehouseSchema = z.object({
  companyId: companyIdSchema,
  name: nonEmptyString,
  code: z.string().max(20).optional(),
  branchId: uuidSchema.optional(),
  isActive: z.boolean().default(true),
});

export const createStockTransferSchema = z.object({
  companyId: companyIdSchema,
  fromWarehouseId: uuidSchema,
  toWarehouseId: uuidSchema,
  date: dateSchema,
  transferNumber: z.string().max(50).optional(),
  reference: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(['draft', 'pending', 'completed', 'cancelled']).default('draft'),
  productId: uuidSchema.optional(),
  quantity: currencyAmountSchema.optional(),
  lines: z.array(z.object({
    productId: uuidSchema,
    quantity: currencyAmountSchema.positive(),
  })).optional(),
}).refine(d => d.fromWarehouseId !== d.toWarehouseId, {
  message: 'مستودع المصدر والوجهة يجب أن يكونا مختلفين',
  path: ['toWarehouseId'],
});

export const createStockAdjustmentSchema = z.object({
  companyId: companyIdSchema,
  date: dateSchema,
  productId: uuidSchema,
  warehouseId: uuidSchema,
  systemQty: currencyAmountSchema.default(0),
  actualQty: currencyAmountSchema.default(0),
  difference: currencyAmountSchema.default(0),
  unitCost: currencyAmountSchema.optional(),
  reason: z.string().max(2000).optional(),
  status: z.enum(['draft', 'pending', 'approved', 'rejected', 'posted']).default('draft'),
});

export const createInventoryTransactionSchema = z.object({
  companyId: companyIdSchema,
  date: dateSchema,
  type: z.enum(['in', 'out', 'adjustment', 'transfer']),
  productId: uuidSchema,
  warehouseId: uuidSchema,
  quantity: currencyAmountSchema.positive(),
  reference: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export const createProductCategorySchema = z.object({
  companyId: companyIdSchema,
  name: nonEmptyString,
  parentId: uuidSchema.optional(),
});

export const createEmployeeSchema = z.object({
  companyId: companyIdSchema,
  employeeNumber: nonEmptyString,
  fullName: nonEmptyString,
  nationalId: z.string().max(50).optional(),
  phone: phoneSchema,
  email: emailSchema,
  address: z.string().max(1000).optional(),
  departmentId: uuidSchema.optional(),
  position: z.string().max(100).optional(),
  grade: z.string().max(50).optional(),
  hireDate: dateSchema.optional(),
  terminationDate: dateSchema.optional(),
  baseSalary: currencyAmountSchema.optional(),
  openingBalance: currencyAmountSchema.optional(),
  openingBalancePosted: z.boolean().optional(),
  isActive: z.boolean().default(true),
  photoUrl: z.string().max(2000000).optional(),
  attachments: z.array(z.string()).optional(),
});

export const createLeadSchema = z.object({
  companyId: companyIdSchema,
  name: nonEmptyString,
  phone: phoneSchema,
  email: emailSchema,
  company: z.string().max(255).optional(),
  source: z.string().max(100).optional(),
  status: z.enum(['new', 'contacted', 'qualified', 'converted', 'lost']).default('new'),
  rating: z.enum(['hot', 'warm', 'cold']).default('warm'),
  estimatedValue: currencyAmountSchema.optional(),
  assignedTo: uuidSchema.optional(),
  notes: z.string().max(2000).optional(),
});

export const updateLeadSchema = z.object({
  name: nonEmptyString.optional(),
  phone: phoneSchema,
  email: emailSchema,
  company: z.string().max(255).optional(),
  source: z.string().max(100).optional(),
  status: z.enum(['new', 'contacted', 'qualified', 'converted', 'lost']).optional(),
  rating: z.enum(['hot', 'warm', 'cold']).optional(),
  estimatedValue: currencyAmountSchema.optional(),
  assignedTo: uuidSchema.optional().nullable(),
  notes: z.string().max(2000).optional(),
});

export const createOpportunitySchema = z.object({
  companyId: companyIdSchema,
  name: nonEmptyString,
  value: currencyAmountSchema.default(0),
  stage: z.enum(['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost']).default('new'),
  probability: percentageSchema.optional(),
  expectedCloseDate: dateSchema.optional(),
  leadId: uuidSchema.optional().nullable(),
  customerId: uuidSchema.optional().nullable(),
  assignedTo: uuidSchema.optional().nullable(),
  notes: z.string().max(2000).optional(),
});

export const updateOpportunitySchema = z.object({
  name: nonEmptyString.optional(),
  value: currencyAmountSchema.optional(),
  stage: z.enum(['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost']).optional(),
  probability: percentageSchema.optional(),
  expectedCloseDate: dateSchema.optional(),
  leadId: uuidSchema.optional().nullable(),
  customerId: uuidSchema.optional().nullable(),
  assignedTo: uuidSchema.optional().nullable(),
  notes: z.string().max(2000).optional(),
});

export const createTaskSchema = z.object({
  companyId: companyIdSchema,
  title: nonEmptyString,
  description: z.string().max(2000).optional(),
  dueDate: dateSchema.optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  status: z.enum(['pending', 'completed', 'cancelled']).default('pending'),
  leadId: uuidSchema.optional().nullable(),
  opportunityId: uuidSchema.optional().nullable(),
  customerId: uuidSchema.optional().nullable(),
  assignedTo: uuidSchema.optional().nullable(),
});

export const updateTaskSchema = z.object({
  title: nonEmptyString.optional(),
  description: z.string().max(2000).optional(),
  dueDate: dateSchema.optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  status: z.enum(['pending', 'completed', 'cancelled']).optional(),
  leadId: uuidSchema.optional().nullable(),
  opportunityId: uuidSchema.optional().nullable(),
  customerId: uuidSchema.optional().nullable(),
  assignedTo: uuidSchema.optional().nullable(),
});

export const createActivitySchema = z.object({
  companyId: companyIdSchema,
  type: z.enum(['call', 'meeting', 'email', 'visit', 'note']),
  subject: nonEmptyString,
  description: z.string().max(2000).optional(),
  activityDate: z.string().min(1),
  durationMinutes: z.number().int().min(0).optional(),
  leadId: uuidSchema.optional().nullable(),
  opportunityId: uuidSchema.optional().nullable(),
  customerId: uuidSchema.optional().nullable(),
  assignedTo: uuidSchema.optional().nullable(),
});

export const updateActivitySchema = z.object({
  type: z.enum(['call', 'meeting', 'email', 'visit', 'note']).optional(),
  subject: nonEmptyString.optional(),
  description: z.string().max(2000).optional(),
  activityDate: z.string().min(1).optional(),
  durationMinutes: z.number().int().min(0).optional(),
  leadId: uuidSchema.optional().nullable(),
  opportunityId: uuidSchema.optional().nullable(),
  customerId: uuidSchema.optional().nullable(),
  assignedTo: uuidSchema.optional().nullable(),
});

export const createBomSchema = z.object({
  companyId: companyIdSchema,
  productId: uuidSchema,
  version: nonEmptyString,
  isActive: z.boolean().default(true),
  totalCost: currencyAmountSchema.optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(z.object({
    materialId: uuidSchema,
    quantity: currencyAmountSchema,
    unitCost: currencyAmountSchema.optional(),
  })).min(1),
});

export const createWorkOrderSchema = z.object({
  companyId: companyIdSchema,
  orderNumber: nonEmptyString,
  productId: uuidSchema,
  bomId: uuidSchema.optional(),
  quantity: currencyAmountSchema,
  status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).default('planned'),
  plannedStartDate: dateSchema.optional(),
  plannedEndDate: dateSchema.optional(),
  totalCost: currencyAmountSchema.optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(z.object({
    materialId: uuidSchema,
    plannedQuantity: currencyAmountSchema,
    unitCost: currencyAmountSchema.optional(),
  })).optional(),
});
