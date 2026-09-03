import { describe, it, expect } from 'vitest';

// Pure helper test — auditActionFor derives the honest audit verb from the
// tool name; no DB, no stores, no mocks needed.
import { auditActionFor } from './toolExecutor';

/**
 * P1-5 regression: the audit trail logged action:'create' for EVERY write
 * tool — a `settings.delete_cash_box` run appeared as a "create" in the log.
 * The action must be derived from the tool verb, and it must be one of the
 * AuditLog union members.
 */
describe('auditActionFor — honest audit verbs', () => {
  it('create_ and generate_ map to create', () => {
    expect(auditActionFor('sales.create_invoice')).toBe('create');
    expect(auditActionFor('hr.generate_payroll_run')).toBe('create');
    expect(auditActionFor('settings.create_cash_box')).toBe('create');
  });

  it('delete_ and deactivate_ map to delete', () => {
    expect(auditActionFor('settings.delete_cash_box')).toBe('delete');
    expect(auditActionFor('crm.delete_lead')).toBe('delete');
    expect(auditActionFor('settings.deactivate_payroll_component')).toBe('delete');
  });

  it('post_/pay_/apply_ map to post', () => {
    expect(auditActionFor('sales.post_invoice')).toBe('post');
    expect(auditActionFor('hr.pay_end_of_service')).toBe('post');
    expect(auditActionFor('settings.apply_default_template')).toBe('post');
  });

  it('update_/convert_/win_/complete_/save_/start_ map to update', () => {
    expect(auditActionFor('accounting.update_account')).toBe('update');
    expect(auditActionFor('crm.convert_lead_to_customer')).toBe('update');
    expect(auditActionFor('crm.win_opportunity')).toBe('update');
    expect(auditActionFor('crm.complete_task')).toBe('update');
    expect(auditActionFor('hr.save_attendance')).toBe('update');
    expect(auditActionFor('manufacturing.start_work_order_status')).toBe('update');
  });

  it('process_ flows (multi-step wizards) map to post — the dominant effect', () => {
    expect(auditActionFor('hr.process_payroll_flow')).toBe('post');
  });

  it('unknown verbs fall back to update — NEVER claim a create that did not happen', () => {
    expect(auditActionFor('whatever.mystery_action')).toBe('update');
  });
});
