import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertTransition,
  isPostedStatus,
  assertMutable,
} from './stateMachine';

describe('stateMachine', () => {
  describe('canTransition', () => {
    it('allows draft → posted for invoices', () => {
      expect(canTransition('invoice', 'draft', 'posted')).toBe(true);
    });

    it('allows draft → cancelled for invoices', () => {
      expect(canTransition('invoice', 'draft', 'cancelled')).toBe(true);
    });

    it('allows posted → paid for invoices', () => {
      expect(canTransition('invoice', 'posted', 'paid')).toBe(true);
    });

    it('allows posted → partially_paid for invoices', () => {
      expect(canTransition('invoice', 'posted', 'partially_paid')).toBe(true);
    });

    it('allows partially_paid → paid for invoices', () => {
      expect(canTransition('invoice', 'partially_paid', 'paid')).toBe(true);
    });

    it('blocks posted → draft (immutable)', () => {
      expect(canTransition('invoice', 'posted', 'draft')).toBe(false);
    });

    it('blocks paid → draft (immutable)', () => {
      expect(canTransition('invoice', 'paid', 'draft')).toBe(false);
    });

    it('blocks paid → partially_paid (no un-paying)', () => {
      expect(canTransition('invoice', 'paid', 'partially_paid')).toBe(false);
    });

    it('allows draft → posted for returns', () => {
      expect(canTransition('return', 'draft', 'posted')).toBe(true);
    });

    it('allows posted → cancelled for returns', () => {
      expect(canTransition('return', 'posted', 'cancelled')).toBe(true);
    });

    it('blocks posted → draft for returns', () => {
      expect(canTransition('return', 'posted', 'draft')).toBe(false);
    });

    it('allows draft → sent for quotations', () => {
      expect(canTransition('quotation', 'draft', 'sent')).toBe(true);
    });

    it('allows accepted → converted for quotations', () => {
      expect(canTransition('quotation', 'accepted', 'converted')).toBe(true);
    });

    it('blocks converted → draft for quotations', () => {
      expect(canTransition('quotation', 'converted', 'draft')).toBe(false);
    });

    it('allows draft → confirmed for orders', () => {
      expect(canTransition('order', 'draft', 'confirmed')).toBe(true);
    });

    it('allows confirmed → invoiced for orders', () => {
      expect(canTransition('order', 'confirmed', 'invoiced')).toBe(true);
    });

    it('allows planned → in_progress for work orders', () => {
      expect(canTransition('work_order', 'planned', 'in_progress')).toBe(true);
    });

    it('allows in_progress → completed for work orders', () => {
      expect(canTransition('work_order', 'in_progress', 'completed')).toBe(true);
    });

    it('blocks completed → in_progress for work orders', () => {
      expect(canTransition('work_order', 'completed', 'in_progress')).toBe(false);
    });

    it('returns false for unknown family', () => {
      expect(canTransition('unknown' as never, 'draft', 'posted')).toBe(false);
    });
  });

  describe('assertTransition', () => {
    it('returns null for allowed transition', () => {
      expect(assertTransition('invoice', 'draft', 'posted')).toBeNull();
    });

    it('returns error for disallowed transition', () => {
      const result = assertTransition('invoice', 'posted', 'draft');
      expect(result).not.toBeNull();
      if (result && !result.success) {
        expect(result.code).toBe('INVALID_STATE');
        expect(result.error).toContain('posted');
        expect(result.error).toContain('draft');
      }
    });
  });

  describe('isPostedStatus', () => {
    it('returns true for posted', () => {
      expect(isPostedStatus('posted')).toBe(true);
    });

    it('returns true for paid', () => {
      expect(isPostedStatus('paid')).toBe(true);
    });

    it('returns true for partially_paid', () => {
      expect(isPostedStatus('partially_paid')).toBe(true);
    });

    it('returns true for converted', () => {
      expect(isPostedStatus('converted')).toBe(true);
    });

    it('returns true for invoiced', () => {
      expect(isPostedStatus('invoiced')).toBe(true);
    });

    it('returns true for completed', () => {
      expect(isPostedStatus('completed')).toBe(true);
    });

    it('returns true for accepted', () => {
      expect(isPostedStatus('accepted')).toBe(true);
    });

    it('returns false for draft', () => {
      expect(isPostedStatus('draft')).toBe(false);
    });

    it('returns false for cancelled', () => {
      expect(isPostedStatus('cancelled')).toBe(false);
    });

    it('returns false for sent', () => {
      expect(isPostedStatus('sent')).toBe(false);
    });
  });

  describe('assertMutable', () => {
    it('returns null for draft status', () => {
      expect(assertMutable('draft')).toBeNull();
    });

    it('returns null for sent status', () => {
      expect(assertMutable('sent')).toBeNull();
    });

    it('returns error for posted status (edit)', () => {
      const result = assertMutable('posted', 'edit');
      expect(result).not.toBeNull();
      if (result && !result.success) {
        expect(result.code).toBe('PRECONDITION_FAILED');
        expect(result.error).toContain('مرحّل');
      }
    });

    it('returns error for paid status (delete)', () => {
      const result = assertMutable('paid', 'delete');
      expect(result).not.toBeNull();
      if (result && !result.success) {
        expect(result.code).toBe('PRECONDITION_FAILED');
        expect(result.error).toContain('حذف');
      }
    });

    it('returns error for cancelled status', () => {
      const result = assertMutable('cancelled');
      expect(result).not.toBeNull();
      if (result && !result.success) {
        expect(result.error).toContain('ملغي');
      }
    });

    it('returns error for converted status', () => {
      const result = assertMutable('converted');
      expect(result).not.toBeNull();
    });
  });
});
