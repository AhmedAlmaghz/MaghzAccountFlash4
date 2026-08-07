/**
 * Document state machine — enforces valid lifecycle transitions for
 * financial documents (invoices, returns, vouchers, work orders, …).
 *
 * The core ERP integrity rule: **posted documents are immutable**. They can
 * only be cancelled (reversed), never edited or deleted. This module
 * centralizes that rule so every service uses the same transition table.
 */

import { invalidState, preconditionFailed, type ServiceResult } from './errors';

export type DocumentStatus =
  | 'draft'
  | 'posted'
  | 'paid'
  | 'partially_paid'
  | 'cancelled'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'converted'
  | 'confirmed'
  | 'received'
  | 'invoiced'
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'pending'
  | 'approved'
  | 'rejected_adj';

/**
 * Allowed transitions per document family. Keys not present mean the status
 * is terminal (no further transitions).
 */
type TransitionMap = Partial<Record<DocumentStatus, DocumentStatus[]>>;

const TRANSITIONS: Record<string, TransitionMap> = {
  invoice: {
    draft: ['posted', 'cancelled'],
    posted: ['paid', 'partially_paid', 'cancelled'],
    partially_paid: ['paid', 'cancelled'],
    paid: [],
    cancelled: [],
  },
  return: {
    draft: ['posted', 'cancelled'],
    posted: ['cancelled'],
    cancelled: [],
  },
  quotation: {
    draft: ['sent', 'accepted', 'rejected', 'cancelled'],
    sent: ['accepted', 'rejected', 'cancelled'],
    accepted: ['converted', 'cancelled'],
    rejected: [],
    converted: [],
    cancelled: [],
  },
  order: {
    draft: ['confirmed', 'cancelled'],
    confirmed: ['invoiced', 'received', 'cancelled'],
    received: ['invoiced', 'cancelled'],
    invoiced: [],
    cancelled: [],
  },
  voucher: {
    draft: ['posted', 'cancelled'],
    posted: ['cancelled'],
    cancelled: [],
  },
  work_order: {
    planned: ['in_progress', 'cancelled'],
    in_progress: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  },
  stock_adjustment: {
    draft: ['pending', 'cancelled'],
    pending: ['approved', 'rejected_adj'],
    approved: ['posted'],
    rejected_adj: [],
    posted: [],
    cancelled: [],
  },
};

/**
 * Check whether a transition is allowed for the given document family.
 */
export function canTransition(
  family: keyof typeof TRANSITIONS,
  from: DocumentStatus,
  to: DocumentStatus
): boolean {
  const table = TRANSITIONS[family];
  if (!table) return false;
  const allowed = table[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/**
 * Assert a transition is allowed; return a `ServiceResult` error if not.
 */
export function assertTransition(
  family: keyof typeof TRANSITIONS,
  from: DocumentStatus,
  to: DocumentStatus
): ServiceResult<never> | null {
  if (canTransition(family, from, to)) return null;
  return invalidState(`لا يمكن تغيير حالة المستند من "${from}" إلى "${to}"`);
}

/**
 * Returns true if the status is a "posted" (immutable) state — the document
 * has been committed to the ledger and cannot be edited or deleted directly.
 */
export function isPostedStatus(status: DocumentStatus): boolean {
  return (
    status === 'posted' ||
    status === 'paid' ||
    status === 'partially_paid' ||
    status === 'converted' ||
    status === 'invoiced' ||
    status === 'completed' ||
    status === 'accepted'
  );
}

/**
 * Guard against editing/deleting a posted document. Returns a
 * `PRECONDITION_FAILED` error if the document is in an immutable state.
 */
export function assertMutable(
  status: DocumentStatus,
  operation: 'edit' | 'delete' = 'edit'
): ServiceResult<never> | null {
  if (isPostedStatus(status)) {
    const verb = operation === 'delete' ? 'حذف' : 'تعديل';
    return preconditionFailed(
      `لا يمكن ${verb} مستند مرحّل (الحالة: "${status}'). استخدم إجراء العكس أو الإلغاء.`
    );
  }
  if (status === 'cancelled') {
    return preconditionFailed('لا يمكن تعديل أو حذف مستند ملغي');
  }
  return null;
}