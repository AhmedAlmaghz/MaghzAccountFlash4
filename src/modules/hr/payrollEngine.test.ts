import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HR_POLICY,
  buildPolicy,
  computeLeaveDays,
  leavesOverlap,
  computeLeaveBalance,
  computePayrollLine,
  computePayroll,
  computeEos,
  deriveAttendance,
  round2,
} from './payrollEngine';

const policy = DEFAULT_HR_POLICY;

describe('round2', () => {
  it('rounds to 2 decimals with float safety', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBe(1.01);
  });
  it('returns 0 for non-finite', () => {
    expect(round2(NaN)).toBe(0);
    expect(round2(Infinity)).toBe(0);
  });
});

describe('buildPolicy', () => {
  it('coerces raw DB strings and applies defaults for missing keys', () => {
    const p = buildPolicy({
      'hr.leave.annualDays': '30',
      'hr.overtimeRate': '2',
      // missing keys → defaults
    });
    expect(p.annualLeaveDays).toBe(30);
    expect(p.overtimeRate).toBe(2);
    expect(p.sickLeaveDays).toBe(30);
    expect(p.standardWorkHours).toBe(8);
    expect(p.eosFirstYearsMultiplier).toBe(0.5);
  });
  it('falls back to defaults on garbage values', () => {
    const p = buildPolicy({ 'hr.overtimeRate': 'abc' });
    expect(p.overtimeRate).toBe(1.5);
  });
});

describe('computeLeaveDays', () => {
  it('counts inclusive days', () => {
    expect(computeLeaveDays('2026-08-01', '2026-08-10')).toBe(10);
    expect(computeLeaveDays('2026-08-01', '2026-08-01')).toBe(1);
  });
  it('returns 0 for reversed or invalid ranges', () => {
    expect(computeLeaveDays('2026-08-10', '2026-08-01')).toBe(0);
    expect(computeLeaveDays('', '2026-08-01')).toBe(0);
    expect(computeLeaveDays('garbage', '2026-08-01')).toBe(0);
  });
});

describe('leavesOverlap', () => {
  it('detects intersections', () => {
    expect(leavesOverlap('2026-08-01', '2026-08-10', '2026-08-05', '2026-08-15')).toBe(true);
    expect(leavesOverlap('2026-08-01', '2026-08-10', '2026-08-11', '2026-08-20')).toBe(false);
    expect(leavesOverlap('2026-08-01', '2026-08-10', '2026-08-10', '2026-08-10')).toBe(true);
  });
});

describe('computeLeaveBalance', () => {
  it('caps annual leave at entitlement minus used', () => {
    const b = computeLeaveBalance({ leaveType: 'annual', usedDays: 5, policy });
    expect(b.entitled).toBe(21);
    expect(b.remaining).toBe(16);
    expect(b.uncapped).toBe(false);
  });
  it('returns Infinity for uncapped unpaid leave', () => {
    const b = computeLeaveBalance({ leaveType: 'unpaid', usedDays: 100, policy });
    expect(b.uncapped).toBe(true);
    expect(b.remaining).toBe(Infinity);
  });
  it('never returns negative remaining', () => {
    const b = computeLeaveBalance({ leaveType: 'annual', usedDays: 30, policy });
    expect(b.remaining).toBe(0);
  });
});

const components = [
  { code: 'HOU', nameAr: 'بدل سكن', type: 'earning' as const, calculationMethod: 'fixed' as const, defaultAmount: 150_000 },
  { code: 'TRN', nameAr: 'بدل نقل', type: 'earning' as const, calculationMethod: 'fixed' as const, defaultAmount: 50_000 },
  { code: 'INS', nameAr: 'تأمينات', type: 'deduction' as const, calculationMethod: 'percentage' as const, defaultAmount: 9 },
];

describe('computePayrollLine', () => {
  it('computes base + earnings + overtime − deductions', () => {
    // base 300,000 → hourly = 300000/30/8 = 1250; OT 4h × 1.5 → 7500
    const line = computePayrollLine(
      { employeeId: 'e1', baseSalary: 300_000, overtimeHours: 4 },
      components,
      policy,
    );
    expect(line.allowances).toBe(200_000);
    expect(line.overtime).toBe(7500);
    expect(line.deductions).toBe(27_000); // 9% of base
    expect(line.gross).toBe(507_500);
    expect(line.netSalary).toBe(480_500);
  });

  it('applies per-employee component overrides', () => {
    const line = computePayrollLine(
      { employeeId: 'e1', baseSalary: 100_000, overtimeHours: 0 },
      components,
      policy,
      { employeeId: 'e1', components: { HOU: 250_000 } },
    );
    expect(line.allowances).toBe(300_000);
    expect(line.deductions).toBe(9000);
  });

  it('applies extra allowances/deductions AFTER components', () => {
    const line = computePayrollLine(
      { employeeId: 'e1', baseSalary: 100_000, overtimeHours: 0 },
      components,
      policy,
      { employeeId: 'e1', extraAllowances: 10_000, extraDeductions: 5000 },
    );
    expect(line.allowances).toBe(210_000);
    expect(line.deductions).toBe(14_000);
  });

  it('ignores net-type components (display-only)', () => {
    const withNet = [...components, { code: 'NET', nameAr: 'الصافي', type: 'net' as const, calculationMethod: 'fixed' as const, defaultAmount: 999_999 }];
    const line = computePayrollLine({ employeeId: 'e1', baseSalary: 100_000, overtimeHours: 0 }, withNet, policy);
    expect(line.netSalary).not.toBe(100_000 - 999_999);
  });

  it('treats negative base/overtime as zero (defensive)', () => {
    const line = computePayrollLine({ employeeId: 'e1', baseSalary: -5, overtimeHours: -3 }, components, policy);
    expect(line.baseSalary).toBe(0);
    expect(line.overtimeHours).toBe(0);
    expect(line.overtime).toBe(0);
  });
});

describe('computePayroll (run-level)', () => {
  it('aggregates totals across lines', () => {
    const run = computePayroll(
      [
        { employeeId: 'e1', baseSalary: 300_000, overtimeHours: 4 },
        { employeeId: 'e2', baseSalary: 200_000, overtimeHours: 0 },
      ],
      components,
      policy,
    );
    expect(run.lines).toHaveLength(2);
    expect(run.totalOvertimeHours).toBe(4);
    // gross = 507500 (e1) + 400000 (e2: 200k base + 200k allowances)
    expect(run.totalGross).toBe(907_500);
    // deductions: 27000 + 18000
    expect(run.totalDeductions).toBe(45_000);
    expect(run.totalNet).toBe(862_500);
  });
});

describe('computeEos', () => {
  it('half month per year for first 5 years', () => {
    // 3 years × 0.5 × 100,000 = 150,000
    const eos = computeEos('2023-08-01', '2026-08-01', 100_000, 'resignation', policy);
    expect(eos.serviceYears).toBe(3);
    expect(eos.eosAmount).toBe(150_000);
    expect(eos.firstYearsAmount).toBe(150_000);
    expect(eos.beyondYearsAmount).toBe(0);
  });

  it('full month per year beyond 5 years', () => {
    // 7 years: 5×0.5×100k + 2×1×100k = 250k + 200k = 450k
    const eos = computeEos('2019-08-01', '2026-08-01', 100_000, 'resignation', policy);
    expect(eos.serviceYears).toBe(7);
    expect(eos.firstYearsAmount).toBe(250_000);
    expect(eos.beyondYearsAmount).toBe(200_000);
    expect(eos.eosAmount).toBe(450_000);
  });

  it('returns zeros for invalid date order', () => {
    const eos = computeEos('2026-08-01', '2023-08-01', 100_000, 'resignation', policy);
    expect(eos.serviceYears).toBe(0);
    expect(eos.eosAmount).toBe(0);
  });

  it('honours custom multipliers from policy', () => {
    const custom = { ...policy, eosFirstYearsMultiplier: 1, eosBeyondYearsMultiplier: 1.5 };
    // 3 years full month: 300k; and 7 years: 500k + 300k
    const eos3 = computeEos('2023-08-01', '2026-08-01', 100_000, 'resignation', custom);
    expect(eos3.eosAmount).toBe(300_000);
    const eos7 = computeEos('2019-08-01', '2026-08-01', 100_000, 'resignation', custom);
    expect(eos7.eosAmount).toBe(800_000);
  });

  it('uses exact 365.25-day year (leap-safe)', () => {
    const eos = computeEos('2020-01-01', '2025-01-01', 100_000, 'resignation', policy);
    // 5 years incl. leap days → exactly 5.0 (within rounding)
    expect(eos.serviceYears).toBeCloseTo(5, 1);
  });
});

describe('deriveAttendance', () => {
  it('derives late from official start + grace', () => {
    expect(deriveAttendance('08:00', '17:00', policy, '08:00').isLate).toBe(false);
    expect(deriveAttendance('08:15', '17:00', policy, '08:00').isLate).toBe(false); // exactly at grace
    expect(deriveAttendance('08:16', '17:00', policy, '08:00').isLate).toBe(true);
  });

  it('derives overtime = worked − standard hours', () => {
    expect(deriveAttendance('08:00', '17:00', policy, '08:00').overtimeHours).toBe(1); // 9h − 8h
    expect(deriveAttendance('08:00', '16:00', policy, '08:00').overtimeHours).toBe(0);
    expect(deriveAttendance('08:00', '20:30', policy, '08:00').overtimeHours).toBe(4.5);
  });

  it('handles missing or invalid punches safely', () => {
    expect(deriveAttendance('', '17:00', policy)).toEqual({ isLate: false, overtimeHours: 0, workedHours: 0 });
    expect(deriveAttendance('bad', '17:00', policy)).toEqual({ isLate: false, overtimeHours: 0, workedHours: 0 });
    // checkout before checkin → zero
    expect(deriveAttendance('18:00', '08:00', policy).workedHours).toBe(0);
  });

  it('respects custom grace and work hours from policy', () => {
    const custom = { ...policy, lateGraceMinutes: 30, standardWorkHours: 9 };
    expect(deriveAttendance('08:30', '17:00', custom, '08:00').isLate).toBe(false);
    expect(deriveAttendance('08:00', '17:00', custom, '08:00').overtimeHours).toBe(0); // 9h − 9h
  });

  it('accepts FULL datetime punches ("2026-08-31 08:00") — the AI-tool format', () => {
    // Regression: the old ^(\d{1,2}):(\d{2}) anchor never matched a datetime
    // prefix, so AI-issued attendance derived 0 overtime silently.
    const res = deriveAttendance('2026-08-31 08:00', '2026-08-31 17:00', policy, '08:00');
    expect(res.workedHours).toBe(9);
    expect(res.overtimeHours).toBe(1);
    expect(res.isLate).toBe(false);

    const late = deriveAttendance('2026-08-31T09:30:00', '2026-08-31T17:00:00', policy, '08:00');
    expect(late.isLate).toBe(true);
    expect(late.overtimeHours).toBe(0); // 7.5h − 8h → 0
  });

  it('still accepts time-only punches ("08:00") — the UI format', () => {
    expect(deriveAttendance('08:00', '17:00', policy, '08:00').workedHours).toBe(9);
    expect(deriveAttendance('08:00:00', '17:00:00', policy, '08:00:00').workedHours).toBe(9);
  });

  it('rejects impossible times out of the 24h clock', () => {
    expect(deriveAttendance('25:00', '26:00', policy).workedHours).toBe(0);
    expect(deriveAttendance('08:99', '17:00', policy).workedHours).toBe(0);
  });
});
