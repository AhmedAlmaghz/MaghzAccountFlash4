/**
 * HR Payroll Engine — Pure Functions (Single Source of Truth)
 *
 * EVERY financial calculation in the HR module lives here. The API layer,
 * the React pages, and the AI agent tools all import these same functions —
 * no caller may store its own computed numbers. The API layer re-computes
 * and persists what these functions return (client-supplied derived values
 * are ignored server-side).
 *
 * Design rules:
 *  - Pure: no DB, no I/O, no side effects — fully unit-testable.
 *  - Policy-driven: multipliers, work hours, leave entitlements come from
 *    company HR settings (drizzle/0014_hr_professional.sql defaults), never
 *    hardcoded inside formulas.
 *  - Money: rounded to 2 decimals at the boundary (round2), intermediate
 *    math kept in full precision.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HrPolicy {
  /** Annual leave entitlement (days/year). Default 21. */
  annualLeaveDays: number;
  /** Sick leave entitlement (days/year). Default 30. */
  sickLeaveDays: number;
  /** Emergency leave entitlement (days/year). Default 30. */
  emergencyLeaveDays: number;
  /** Overtime pay multiplier. Default 1.5. */
  overtimeRate: number;
  /** Standard work hours per day. Default 8. */
  standardWorkHours: number;
  /** Minutes after official start that still count as on-time. Default 15. */
  lateGraceMinutes: number;
  /** EOS multiplier for the first 5 service years (of monthly salary). Default 0.5. */
  eosFirstYearsMultiplier: number;
  /** EOS multiplier for service years beyond 5 (of monthly salary). Default 1. */
  eosBeyondYearsMultiplier: number;
}

export const DEFAULT_HR_POLICY: HrPolicy = {
  annualLeaveDays: 21,
  sickLeaveDays: 30,
  emergencyLeaveDays: 30,
  overtimeRate: 1.5,
  standardWorkHours: 8,
  lateGraceMinutes: 15,
  eosFirstYearsMultiplier: 0.5,
  eosBeyondYearsMultiplier: 1,
};

/** Leave entitlement key per leave type. `unpaid` has NO entitlement cap. */
export const LEAVE_ENTITLEMENT_KEY: Record<string, keyof HrPolicy | null> = {
  annual: 'annualLeaveDays',
  sick: 'sickLeaveDays',
  emergency: 'emergencyLeaveDays',
  unpaid: null,
};

export type PayrollComponentType = 'earning' | 'deduction' | 'tax' | 'insurance' | 'net';
export type PayrollCalcMethod = 'fixed' | 'percentage';

export interface PayrollComponentRule {
  code: string;
  nameAr: string;
  type: PayrollComponentType;
  calculationMethod: PayrollCalcMethod;
  /** fixed: absolute amount; percentage: % of base salary. */
  defaultAmount: number;
}

export interface PayrollLineInput {
  employeeId: string;
  employeeName?: string;
  /** Monthly base salary from the employee card (source of truth). */
  baseSalary: number;
  /** Overtime hours worked (usually aggregated from attendance). */
  overtimeHours: number;
}

export interface PayrollLineOverride {
  employeeId: string;
  /** Replace a component value for this employee (fixed amount). */
  components?: Partial<Record<string, number>>;
  /** Direct allowances/deductions adjustments applied AFTER components. */
  extraAllowances?: number;
  extraDeductions?: number;
}

export interface ComputedPayrollLine {
  employeeId: string;
  employeeName?: string;
  baseSalary: number;
  /** Sum of active EARNING components (allowances). */
  allowances: number;
  /** Sum of DEDUCTION/TAX/INSURANCE components. */
  deductions: number;
  /** Overtime pay = hourlyRate × overtimeHours × overtimeRate. */
  overtime: number;
  overtimeHours: number;
  netSalary: number;
  /** Gross payroll expense = base + allowances + overtime (before deductions). */
  gross: number;
}

export interface ComputedPayroll {
  lines: ComputedPayrollLine[];
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalOvertimeHours: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toNum(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

/** Coerce raw settings rows (strings from DB) into a full HrPolicy. */
export function buildPolicy(rows: Record<string, unknown>): HrPolicy {
  return {
    annualLeaveDays: toNum(rows['hr.leave.annualDays'], DEFAULT_HR_POLICY.annualLeaveDays),
    sickLeaveDays: toNum(rows['hr.leave.sickDays'], DEFAULT_HR_POLICY.sickLeaveDays),
    emergencyLeaveDays: toNum(rows['hr.leave.emergencyDays'], DEFAULT_HR_POLICY.emergencyLeaveDays),
    overtimeRate: toNum(rows['hr.overtimeRate'], DEFAULT_HR_POLICY.overtimeRate),
    standardWorkHours: toNum(rows['hr.standardWorkHours'], DEFAULT_HR_POLICY.standardWorkHours),
    lateGraceMinutes: toNum(rows['hr.lateGraceMinutes'], DEFAULT_HR_POLICY.lateGraceMinutes),
    eosFirstYearsMultiplier: toNum(rows['hr.eos.firstYearsMultiplier'], DEFAULT_HR_POLICY.eosFirstYearsMultiplier),
    eosBeyondYearsMultiplier: toNum(rows['hr.eos.beyondYearsMultiplier'], DEFAULT_HR_POLICY.eosBeyondYearsMultiplier),
  };
}

// ─── Leaves ──────────────────────────────────────────────────────────────────

/** Inclusive day count between two YYYY-MM-DD dates; 0 when invalid range. */
export function computeLeaveDays(startDate: string, endDate: string): number {
  if (!startDate || !endDate) return 0;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  const diffDays = Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
  return diffDays >= 0 ? diffDays + 1 : 0;
}

/** True when [start,end] intersects any existing [start,end] range. */
export function leavesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export interface LeaveBalanceInput {
  leaveType: string;
  /** Approved + pending days of this type within the same calendar year. */
  usedDays: number;
  policy: HrPolicy;
}

export interface LeaveBalance {
  leaveType: string;
  entitled: number;
  used: number;
  remaining: number;
  /** unpaid leaves are uncapped. */
  uncapped: boolean;
}

export function computeLeaveBalance(input: LeaveBalanceInput): LeaveBalance {
  const key = LEAVE_ENTITLEMENT_KEY[input.leaveType] ?? null;
  if (key === null) {
    return { leaveType: input.leaveType, entitled: Infinity, used: input.usedDays, remaining: Infinity, uncapped: true };
  }
  const entitled = Math.max(0, toNum(input.policy[key]));
  const used = Math.max(0, input.usedDays);
  return { leaveType: input.leaveType, entitled, used, remaining: round2(Math.max(0, entitled - used)), uncapped: false };
}

// ─── Payroll ─────────────────────────────────────────────────────────────────

/**
 * Compute ONE payroll line from the employee card + component rules.
 *
 * netSalary = base + Σ(earnings) + overtime − Σ(deductions)
 * overtime  = (base / 30 / standardWorkHours) × overtimeHours × overtimeRate
 *
 * Overrides (per-employee) replace component values or add direct extras —
 * used by the UI preview table so the user adjusts ONE place and the server
 * recomputes the same way.
 */
export function computePayrollLine(
  input: PayrollLineInput,
  components: PayrollComponentRule[],
  policy: HrPolicy,
  override?: PayrollLineOverride,
): ComputedPayrollLine {
  const base = Math.max(0, toNum(input.baseSalary));
  const otHours = Math.max(0, toNum(input.overtimeHours));

  let allowances = 0;
  let deductions = 0;
  for (const c of components) {
    if (c.type === 'net') continue; // 'net' components are display-only
    let value = toNum(c.defaultAmount);
    if (override?.components && c.code in override.components) {
      value = toNum(override.components[c.code]);
    }
    if (c.calculationMethod === 'percentage') value = (base * value) / 100;
    if (c.type === 'earning') allowances += value;
    else deductions += value; // deduction | tax | insurance
  }

  const hourlyRate = policy.standardWorkHours > 0 ? base / 30 / policy.standardWorkHours : 0;
  const overtime = round2(hourlyRate * otHours * Math.max(0, policy.overtimeRate));

  const extraAllow = Math.max(0, toNum(override?.extraAllowances));
  const extraDeduct = Math.max(0, toNum(override?.extraDeductions));

  allowances = round2(allowances + extraAllow);
  deductions = round2(deductions + extraDeduct);
  const gross = round2(base + allowances + overtime);
  const netSalary = round2(gross - deductions);

  return {
    employeeId: input.employeeId,
    employeeName: input.employeeName,
    baseSalary: round2(base),
    allowances,
    deductions,
    overtime,
    overtimeHours: otHours,
    netSalary,
    gross,
  };
}

/** Compute a whole run (sorted by input order). */
export function computePayroll(
  lines: PayrollLineInput[],
  components: PayrollComponentRule[],
  policy: HrPolicy,
  overrides?: PayrollLineOverride[],
): ComputedPayroll {
  const byEmp = new Map((overrides || []).map((o) => [o.employeeId, o]));
  const computed = lines.map((l) => computePayrollLine(l, components, policy, byEmp.get(l.employeeId)));
  return {
    lines: computed,
    totalGross: round2(computed.reduce((s, l) => s + l.gross, 0)),
    totalDeductions: round2(computed.reduce((s, l) => s + l.deductions, 0)),
    totalNet: round2(computed.reduce((s, l) => s + l.netSalary, 0)),
    totalOvertimeHours: round2(computed.reduce((s, l) => s + l.overtimeHours, 0)),
  };
}

// ─── End of Service ──────────────────────────────────────────────────────────

export interface ComputedEos {
  /** Service years with 2-decimal precision. */
  serviceYears: number;
  lastSalary: number;
  eosAmount: number;
  /** Breakdown for display: first-5-years portion + beyond-5 portion. */
  firstYearsAmount: number;
  beyondYearsAmount: number;
}

/**
 * Gratuity (Odoo/QuickBooks-style progressive formula, Yemeni/Gulf practice):
 *   first ≤5 years  : lastSalary × firstYearsMultiplier × min(years, 5)
 *   years beyond 5  : lastSalary × beyondYearsMultiplier × max(0, years − 5)
 * `reason` reserved for future reason-sensitive rules — the base formula is
 * policy-configurable so companies can tune multipliers without code changes.
 */
export function computeEos(
  hireDate: string,
  terminationDate: string,
  lastSalary: number,
  _reason: string,
  policy: HrPolicy,
): ComputedEos {
  const salary = Math.max(0, toNum(lastSalary));
  const hire = new Date(`${hireDate}T00:00:00`);
  const term = new Date(`${terminationDate}T00:00:00`);
  if (isNaN(hire.getTime()) || isNaN(term.getTime()) || term < hire) {
    return { serviceYears: 0, lastSalary: salary, eosAmount: 0, firstYearsAmount: 0, beyondYearsAmount: 0 };
  }
  const ms = term.getTime() - hire.getTime();
  const serviceYears = round2(Math.max(0, ms / (365.25 * 86_400_000)));

  const firstMult = Math.max(0, policy.eosFirstYearsMultiplier);
  const beyondMult = Math.max(0, policy.eosBeyondYearsMultiplier);
  const capped = Math.min(serviceYears, 5);
  const beyond = Math.max(0, serviceYears - 5);
  const firstYearsAmount = round2(salary * firstMult * capped);
  const beyondYearsAmount = round2(salary * beyondMult * beyond);

  return {
    serviceYears,
    lastSalary: salary,
    eosAmount: round2(firstYearsAmount + beyondYearsAmount),
    firstYearsAmount,
    beyondYearsAmount,
  };
}

// ─── Attendance ──────────────────────────────────────────────────────────────

export interface DerivedAttendance {
  /** True when checkIn exceeds officialStart + grace. */
  isLate: boolean;
  /** Overtime hours = hours worked − standardWorkHours (≥ 0). */
  overtimeHours: number;
  /** Total hours worked (0 when missing punches). */
  workedHours: number;
}

/**
 * Derive late/overtime from punches + policy. `officialStart` is the
 * work-day start "HH:MM" (defaults 08:00 when empty so API callers can pass
 * policy values; the API uses settings when present).
 */
export function deriveAttendance(
  checkIn: string,
  checkOut: string,
  policy: HrPolicy,
  officialStart = '08:00',
): DerivedAttendance {
  const toMin = (t: string): number => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '').trim());
    if (!m) return NaN;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  const inMin = toMin(checkIn);
  const outMin = toMin(checkOut);
  if (!Number.isFinite(inMin) || !Number.isFinite(outMin) || outMin <= inMin) {
    return { isLate: false, overtimeHours: 0, workedHours: 0 };
  }
  const startMin = Number.isFinite(toMin(officialStart)) ? toMin(officialStart) : 8 * 60;
  const workedHours = round2((outMin - inMin) / 60);
  const isLate = inMin > startMin + Math.max(0, policy.lateGraceMinutes);
  const overtimeHours = round2(Math.max(0, workedHours - Math.max(0, policy.standardWorkHours)));
  return { isLate, overtimeHours, workedHours };
}
