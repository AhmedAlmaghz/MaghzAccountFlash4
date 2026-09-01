export interface Lead {
  id: string;
  companyId: string;
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  source?: string;
  status: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
  rating: 'hot' | 'warm' | 'cold';
  estimatedValue?: number;
  assignedTo?: string;
  assignedName?: string;
  notes?: string;
  /** Auto-stamped when a linked activity (call/visit/…) is logged for this lead. */
  lastContactedAt?: string;
  createdAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

export const OPPORTUNITY_STAGES = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
/** Open (non-final) stages in strict forward progression order. */
export const OPPORTUNITY_OPEN_STAGES = ['new', 'qualified', 'proposal', 'negotiation'] as const;
/** Final stages — once entered, the opportunity is locked. */
export const OPPORTUNITY_FINAL_STAGES = ['won', 'lost'] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

/**
 * Strict stage machine: forward-only among the open stages, and the final
 * stages (won/lost) are terminal. The API layer enforces this — the UI only
 * renders what the machine allows.
 */
export function isValidStageTransition(from: string, to: string): boolean {
  if (from === to) return true;
  if (from === 'won' || from === 'lost') return false; // final — locked
  const fromIdx = (OPPORTUNITY_OPEN_STAGES as readonly string[]).indexOf(from);
  const toIdx = (OPPORTUNITY_OPEN_STAGES as readonly string[]).indexOf(to);
  if (fromIdx !== -1 && toIdx !== -1) return toIdx > fromIdx; // forward only
  return to === 'won' || to === 'lost'; // open → final is allowed
}

export function stageTransitionError(from: string, to: string): string {
  if (from === 'won' || from === 'lost') {
    return `لا يمكن تغيير مرحلة فرصة مقفلة (${from === 'won' ? 'مكسوبة' : 'خاسرة'}).`;
  }
  return `انتقال غير قانوني من مرحلة "${from}" إلى "${to}" — التقدم للأمام فقط والمرحلتان won/lost نهائيتان.`;
}

export interface Opportunity {
  id: string;
  companyId: string;
  leadId?: string;
  customerId?: string;
  name: string;
  value: number;
  stage: OpportunityStage;
  probability?: number;
  expectedCloseDate?: string;
  /** Stamped automatically when the stage becomes won/lost. */
  closeDate?: string;
  assignedTo?: string;
  assignedName?: string;
  notes?: string;
  createdAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface Task {
  id: string;
  companyId: string;
  opportunityId?: string;
  leadId?: string;
  customerId?: string;
  title: string;
  description?: string;
  dueDate?: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'completed' | 'cancelled';
  assignedTo?: string;
  assignedName?: string;
  createdAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface Activity {
  id: string;
  companyId: string;
  leadId?: string;
  opportunityId?: string;
  customerId?: string;
  type: 'call' | 'meeting' | 'email' | 'visit' | 'note';
  subject: string;
  description?: string;
  activityDate: string;
  durationMinutes?: number;
  assignedTo?: string;
  assignedName?: string;
  createdAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

/** Options accepted by convertLeadToCustomer (all optional — prefilled from the lead). */
export interface ConvertLeadOptions {
  /** Explicit customer code — when omitted, generated from document_sequences. */
  code?: string;
  address?: string;
  taxNumber?: string;
  creditLimit?: number;
  /** Override contact phone (defaults to the lead's phone). */
  phone?: string;
  /** Override contact email (defaults to the lead's email). */
  email?: string;
  /** Also create a first opportunity ("فرصة [lead name]") in the same atomic operation. */
  createOpportunity?: boolean;
}

export interface ConvertLeadResult {
  customerId: string;
  customerCode: string;
  opportunityId?: string;
}
