import type { ToolDefinition } from '../types';
import { hrApi } from '@/modules/hr/api';
import { normalizeArabic, fuzzyMatchScore } from '@/core/utils/normalizeArabic';

/**
 * HR professional tools — built on the professionalized hrApi surface where
 * the SERVER is the single source of truth:
 *  - payroll: preview → create(draft) → post; values recomputed server-side
 *  - leaves: server-computed days + strict balance enforcement on approval
 *  - end of service: server-computed years/amount; pay needs a cash box
 *  - attendance: late/overtime derived server-side from company policy
 */

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Token-aware fuzzy search (same pattern as searchTools.fuzzySearch): the full
 * query or any individual token (≥2 chars) must score ≥ threshold against the
 * item's key — multi-word Arabic requests match per-token while exact hits rank
 * highest. Returns best-first matches capped at `limit`.
 */
function fuzzySearch<T>(
  query: string,
  items: T[],
  keyFn: (item: T) => string,
  limit = 8,
  threshold = 0.35,
): Array<{ item: T; score: number }> {
  const nq = normalizeArabic(query);
  if (!nq) return [];
  const tokens = [...new Set(nq.split(/\s+/).filter((tk) => tk.length >= 2))];
  return items
    .map((item) => {
      const key = normalizeArabic(keyFn(item));
      let best = fuzzyMatchScore(nq, key);
      for (const tk of tokens) {
        const s = fuzzyMatchScore(tk, key);
        if (s > best) best = s;
      }
      return { item, score: best };
    })
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Infinity is not JSON-serializable (becomes null over IPC/LLM boundaries) —
 * uncapped balances report null entitled/remaining with uncapped: true.
 */
function serializeBalance(b: { leaveType: string; entitled: number; used: number; remaining: number; uncapped: boolean }) {
  return {
    leaveType: b.leaveType,
    entitled: Number.isFinite(b.entitled) ? b.entitled : null,
    used: b.used,
    remaining: Number.isFinite(b.remaining) ? b.remaining : null,
    uncapped: b.uncapped,
  };
}

export const hrTools: ToolDefinition[] = [
  // ─── READ: Payroll preview ─────────────────────────────────────────────
  {
    name: 'hr.preview_payroll',
    labelAr: 'معاينة مسير رواتب',
    descriptionAr: 'معاينة مسير رواتب لشهر وسنة — النظام يحسب الأساسي والبدلات والاستقطاعات والأوفر تايم من بطاقات الموظفين ومكونات الرواتب وحضور الشهر. استخدمها قبل إنشاء المسير.',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'number', description: 'الشهر (1-12)' },
        year: { type: 'number', description: 'السنة (مثال: 2026)' },
      },
      required: ['month', 'year'],
    },
    execute: async (args, ctx) => {
      const month = num(args.month);
      const year = num(args.year);
      if (month < 1 || month > 12) return { error: 'الشهر يجب أن يكون بين 1 و 12' };
      if (year < 2000 || year > 2100) return { error: 'سنة غير صحيحة' };
      const res = await hrApi.previewPayrollRun(ctx.companyId, month, year);
      if (!res.success || !res.data) return { error: res.error || 'فشلت معاينة مسير الرواتب' };
      const lines = res.data.lines ?? [];
      return {
        success: true,
        preview: {
          employeeCount: lines.length,
          totalGross: res.data.totalGross,
          totalDeductions: res.data.totalDeductions,
          totalNet: res.data.totalNet,
          lines: lines.map((l) => ({
            employeeId: l.employeeId,
            employeeName: l.employeeName,
            baseSalary: l.baseSalary,
            allowances: l.allowances,
            deductions: l.deductions,
            overtime: l.overtime,
            netSalary: l.netSalary,
          })),
        },
      };
    },
  },

  // ─── READ: Leave balances ───────────────────────────────────────────────
  {
    name: 'hr.get_leave_balances',
    labelAr: 'أرصدة الإجازات',
    descriptionAr: 'يعرض أرصدة الإجازات (annual/sick/emergency/unpaid) لموظف: المستحق والمستخدم والمتبقي لهذه السنة. الإجازات غير المدفوعة uncapped (بلا سقف). استخدمه قبل الموافقة على أي إجازة.',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: 'معرف الموظف (من search.employees) — إلزامي' },
      },
      required: ['employeeId'],
    },
    execute: async (args, ctx) => {
      const employeeId = str(args.employeeId);
      if (!employeeId) return { error: 'employeeId مطلوب — استخدم search.employees أولاً' };
      const res = await hrApi.getLeaveBalances(ctx.companyId, employeeId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب أرصدة الإجازات' };
      return { balances: res.data.map(serializeBalance) };
    },
  },

  // ─── READ: Employee details ─────────────────────────────────────────────
  {
    name: 'hr.get_employee_details',
    labelAr: 'تفاصيل موظف',
    descriptionAr: 'يجلب بطاقة موظف كاملة: الاسم، رقم الموظف، تاريخ التعيين، الراتب الأساسي، القسم، المسمى الوظيفي، وحالة النشاط. استخدمه عند الحاجة لبيانات موظف بعد البحث.',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: 'معرف الموظف (من search.employees) — إلزامي' },
      },
      required: ['employeeId'],
    },
    execute: async (args, ctx) => {
      const employeeId = str(args.employeeId);
      if (!employeeId) return { error: 'employeeId مطلوب — استخدم search.employees أولاً' };
      const res = await hrApi.getEmployeeById(employeeId, ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'الموظف غير موجود' };
      const e = res.data;
      return {
        id: e.id,
        fullName: e.fullName,
        employeeNumber: e.employeeNumber,
        hireDate: e.hireDate,
        baseSalary: e.baseSalary,
        departmentId: e.departmentId,
        departmentName: e.departmentName,
        position: e.position,
        isActive: e.isActive,
      };
    },
  },

  // ─── READ: End-of-service preview ───────────────────────────────────────
  {
    name: 'hr.preview_end_of_service',
    labelAr: 'معاينة نهاية الخدمة',
    descriptionAr: 'يحسب مستحقات نهاية الخدمة قبل الإنشاء: سنوات الخدمة، آخر راتب، المبلغ الإجمالي وتفصيله — كلها من بطاقة الموظف وسياسة الشركة. لا ينشئ أي سجل.',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: 'معرف الموظف (من search.employees) — إلزامي' },
        terminationDate: { type: 'string', description: 'تاريخ الانتهاء YYYY-MM-DD (إلزامي)' },
        reason: { type: 'string', enum: ['resignation', 'termination', 'contract_end', 'retirement'], description: 'سبب إنهاء الخدمة (إلزامي)' },
      },
      required: ['employeeId', 'terminationDate', 'reason'],
    },
    execute: async (args, ctx) => {
      const employeeId = str(args.employeeId);
      const terminationDate = str(args.terminationDate);
      const reason = str(args.reason) as 'resignation' | 'termination' | 'contract_end' | 'retirement';
      if (!employeeId) return { error: 'employeeId مطلوب — استخدم search.employees أولاً' };
      if (!terminationDate) return { error: 'تاريخ الانتهاء مطلوب' };
      if (!reason || !['resignation', 'termination', 'contract_end', 'retirement'].includes(reason)) return { error: 'سبب إنهاء خدمة غير صحيح' };
      const res = await hrApi.previewEndOfService(ctx.companyId, employeeId, terminationDate, reason);
      if (!res.success || !res.data) return { error: res.error || 'فشلت معاينة نهاية الخدمة' };
      return res.data;
    },
  },

  // ─── READ: Payroll components ───────────────────────────────────────────
  {
    name: 'settings.get_payroll_components',
    labelAr: 'قائمة مكونات الرواتب',
    descriptionAr: 'قائمة مكونات الرواتب النشطة (بدلات/استقطاعات) التي يستخدمها النظام تلقائياً في حساب مسيرات الرواتب.',
    permission: 'settings.view',
    dangerLevel: 'read',
    parameters: { type: 'object', properties: {} },
    execute: async (_args, ctx) => {
      const res = await hrApi.getPayrollComponentsList(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب مكونات الرواتب' };
      return {
        components: res.data.map((c) => ({
          id: c.id,
          code: c.code,
          nameAr: c.nameAr,
          type: c.type,
          calculationMethod: c.calculationMethod,
          defaultAmount: c.defaultAmount,
          isActive: c.isActive,
        })),
        totalComponents: res.data.length,
      };
    },
  },

  // ─── WRITE: Generate payroll run (smart create) ─────────────────────────
  {
    name: 'hr.generate_payroll_run',
    labelAr: 'إنشاء مسير رواتب ذكي',
    descriptionAr: 'ينشئ مسير رواتب كمسودة بضغطة واحدة: يعاين الحسابات من بطاقات الموظفين ومكونات الرواتب وحضور الشهر ثم ينشئ المسير بخطوطها المحسوبة تلقائياً. للترحيل استخدم hr.post_payroll_run، وللدورة الكاملة hr.process_payroll_flow.',
    permission: 'hr.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'number', description: 'الشهر (1-12)' },
        year: { type: 'number', description: 'السنة (مثال: 2026)' },
      },
      required: ['month', 'year'],
    },
    summarizeArgs: (a) => `إنشاء مسير رواتب ذكي لشهر ${a.month}/${a.year}`,
    execute: async (args, ctx) => {
      const month = num(args.month);
      const year = num(args.year);
      if (month < 1 || month > 12) return { error: 'الشهر يجب أن يكون بين 1 و 12' };
      if (year < 2000 || year > 2100) return { error: 'سنة غير صحيحة' };

      const preview = await hrApi.previewPayrollRun(ctx.companyId, month, year);
      if (!preview.success || !preview.data) return { error: preview.error || 'فشلت معاينة مسير الرواتب' };
      const lines = preview.data.lines ?? [];
      if (lines.length === 0) return { error: 'لا يوجد موظفون نشطون لهذه الفترة' };

      const res = await hrApi.createPayrollRun({
        companyId: ctx.companyId,
        month,
        year,
        status: 'draft',
        lines: lines.map((l) => ({ employeeId: l.employeeId })),
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء مسير الرواتب' };
      return {
        created: true,
        payrollId: res.id,
        runNumber: null,
        employeeCount: lines.length,
        totalGross: preview.data.totalGross,
        totalNet: preview.data.totalNet,
        status: 'draft',
        note: 'المسير مسودة بخطوط محسوبة تلقائياً — استخدم hr.post_payroll_run للترحيل',
      };
    },
  },

  // ─── WRITE: Save attendance ─────────────────────────────────────────────
  {
    name: 'hr.save_attendance',
    labelAr: 'حفظ حضور يوم',
    descriptionAr: 'يسجل حضور موظفين ليوم واحد: أوقات الدخول/الخروج والحالة. التأخير والأوفر تايم يُشتقان تلقائياً من سياسة الشركة — لا تحسبهما يدوياً. أوقات الدخول بصيغة "YYYY-MM-DD HH:mm".',
    permission: 'hr.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'تاريخ اليوم YYYY-MM-DD (إلزامي)' },
        records: {
          type: 'array',
          description: 'سجلات الحضور (إلزامي — سجل واحد على الأقل)',
          items: {
            type: 'object',
            properties: {
              employeeId: { type: 'string', description: 'معرف الموظف (من search.employees)' },
              checkIn: { type: 'string', description: 'وقت الدخول "YYYY-MM-DD HH:mm" (اختياري)' },
              checkOut: { type: 'string', description: 'وقت الخروج "YYYY-MM-DD HH:mm" (اختياري)' },
              status: { type: 'string', enum: ['present', 'absent', 'late', 'on_leave'], description: 'الحالة (افتراضي present)' },
              overtimeHours: { type: 'number', description: 'أوفر تايم يدوي بالساعات (اختياري — يُشتق تلقائياً عند غيابه)' },
              notes: { type: 'string', description: 'ملاحظات (اختياري)' },
            },
            required: ['employeeId'],
          },
        },
      },
      required: ['date', 'records'],
    },
    summarizeArgs: (a) => {
      const count = Array.isArray(a.records) ? a.records.length : 0;
      return `حفظ حضور ${count} موظف ليوم ${a.date}`;
    },
    execute: async (args, ctx) => {
      const date = str(args.date);
      if (!date) return { error: 'التاريخ مطلوب بصيغة YYYY-MM-DD' };
      const raw = Array.isArray(args.records) ? args.records : [];
      if (raw.length === 0) return { error: 'يجب تمرير سجل حضور واحد على الأقل' };

      const records = raw
        .map((item) => {
          const r = (item ?? {}) as Record<string, unknown>;
          const employeeId = str(r.employeeId);
          if (!employeeId) return null;
          const status = str(r.status);
          const rec: {
            companyId: string;
            employeeId: string;
            date: string;
            checkIn?: string;
            checkOut?: string;
            overtimeHours?: number;
            status: 'present' | 'absent' | 'late' | 'on_leave';
            notes?: string;
          } = {
            companyId: ctx.companyId,
            employeeId,
            date,
            checkIn: str(r.checkIn),
            checkOut: str(r.checkOut),
            overtimeHours: num(r.overtimeHours) || 0,
            status: status && ['present', 'absent', 'late', 'on_leave'].includes(status)
              ? (status as 'present' | 'absent' | 'late' | 'on_leave')
              : 'present',
            notes: str(r.notes),
          };
          return rec;
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (records.length === 0) return { error: 'لا توجد سجلات صالحة (employeeId مطلوب)' };

      const res = await hrApi.saveAttendance(records, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل حفظ الحضور' };
      return {
        saved: true,
        date,
        recordCount: records.length,
        note: 'حُفظ الحضور — التأخير والأوفر تايم يُشتقان تلقائياً من سياسة الشركة',
      };
    },
  },

  // ─── WRITE: Pay end of service ───────────────────────────────────────────
  {
    name: 'hr.pay_end_of_service',
    labelAr: 'دفع مستحقات نهاية خدمة',
    descriptionAr: 'يسدد مستحقات نهاية خدمة معتمدة من خزنة محددة وينشئ قيد التسوية تلقائياً. يجب أن يكون الحساب معتمداً (approved) أولاً عبر hr.update_end_of_service_status. احصل على معرف الخزنة من search.cash_boxes.',
    permission: 'hr.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'معرف حساب نهاية الخدمة (من search.end_of_services) — إلزامي' },
        cashBoxId: { type: 'string', description: 'معرف الخزنة (من search.cash_boxes) — إلزامي' },
      },
      required: ['id', 'cashBoxId'],
    },
    summarizeArgs: (a) => `دفع مستحقات نهاية خدمة ${String(a.id).slice(0, 8)}… من الخزنة ${String(a.cashBoxId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const id = str(args.id);
      const cashBoxId = str(args.cashBoxId);
      if (!id) return { error: 'id مطلوب — استخدم search.end_of_services أولاً' };
      if (!cashBoxId) return { error: 'cashBoxId مطلوب — استخدم search.cash_boxes أولاً' };
      const res = await hrApi.payEndOfService(id, ctx.companyId, cashBoxId, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل دفع مستحقات نهاية الخدمة' };
      return { paid: true, endOfServiceId: id, cashBoxId, note: 'تم الدفع وحجز قيد التسوية محاسبياً' };
    },
  },

  // ─── WRITE: Delete payroll run (draft-only rollback) ────────────────────
  {
    name: 'hr.delete_payroll_run',
    labelAr: 'حذف مسير رواتب',
    descriptionAr: 'يحذف مسير رواتب مسودة — المسيرات المرحّلة محفوظة للسلامة المالية ولا تُحذف. استخدم search.payroll_runs أولاً.',
    permission: 'hr.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'معرف مسير الرواتب (من search.payroll_runs) — إلزامي' },
      },
      required: ['id'],
    },
    summarizeArgs: (a) => `حذف مسير رواتب: ${String(a.id).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const id = str(args.id);
      if (!id) return { error: 'id مطلوب — استخدم search.payroll_runs أولاً' };
      const res = await hrApi.deletePayrollRun(id, ctx.companyId, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل حذف المسير (المسيرات المرحّلة لا تُحذف)' };
      return { deleted: true, payrollRunId: id };
    },
  },

  // ─── READ: Search departments ──────────────────────────────────────────
  {
    name: 'search.departments',
    labelAr: 'البحث في الأقسام',
    descriptionAr: 'يبحث في أقسام الشركة بالاسم أو اسم المدير — يرجع المعرف وعدد الموظفين المرتبطين. استخدمه قبل أي عملية على قسم.',
    permission: 'hr.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'اسم القسم أو المدير (نص حر)' },
      },
      required: ['query'],
    },
    execute: async (args, ctx) => {
      const query = str(args.query);
      if (!query) return { error: 'query مطلوب — اكتب اسم القسم أو المدير' };
      const res = await hrApi.getDepartments(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب الأقسام' };
      const matches = fuzzySearch(query, res.data, (d) => `${d.name} ${d.managerName ?? ''}`);
      if (matches.length === 0) {
        return { departments: [], note: 'لا توجد أقسام مطابقة — جرّب اسماً أدق أو أضف القسم عبر hr.create_department' };
      }
      return {
        departments: matches.map((m) => ({
          id: m.item.id,
          name: m.item.name,
          managerName: m.item.managerName,
          employeeCount: m.item.employeeCount,
        })),
      };
    },
  },

  // ─── WRITE: Create department ───────────────────────────────────────────
  {
    name: 'hr.create_department',
    labelAr: 'إنشاء قسم',
    descriptionAr: 'ينشئ قسماً جديداً باسمه ومديره (اختياري). استخدم search.departments أولاً للتأكد من عدم التكرار.',
    permission: 'hr.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم القسم (إلزامي)' },
        managerId: { type: 'string', description: 'معرف المدير من المستخدمين (اختياري)' },
      },
      required: ['name'],
    },
    summarizeArgs: (a) => `إنشاء قسم: ${String((a as Record<string, unknown>).name || '').slice(0, 30)}`,
    execute: async (args, ctx) => {
      const name = str(args.name);
      if (!name) return { error: 'name مطلوب — اسم القسم إلزامي' };
      const managerId = str(args.managerId);
      const res = await hrApi.createDepartment({ companyId: ctx.companyId, name, managerId }, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل إنشاء القسم' };
      return { created: true, id: res.id, name };
    },
  },

  // ─── WRITE: Update department ────────────────────────────────────────────
  {
    name: 'hr.update_department',
    labelAr: 'تعديل قسم',
    descriptionAr: 'يُعدّل اسم قسم أو مديره. استخدم search.departments أولاً للحصول على المعرف.',
    permission: 'hr.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'معرف القسم (من search.departments) — إلزامي' },
        name: { type: 'string', description: 'الاسم الجديد (اختياري)' },
        managerId: { type: 'string', description: 'معرف المدير الجديد — أرسل null لإزالة المدير (اختياري)' },
      },
      required: ['id'],
    },
    summarizeArgs: (a) => `تعديل قسم: ${String(a.id).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const id = str(args.id);
      if (!id) return { error: 'id مطلوب — استخدم search.departments أولاً' };
      const data: { name?: string; managerId?: string | null } = {};
      if (args.name !== undefined) {
        const name = str(args.name);
        if (!name) return { error: 'name لا يمكن أن يكون فارغاً' };
        data.name = name;
      }
      if (args.managerId !== undefined) {
        data.managerId = str(args.managerId) ?? null;
      }
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل (name أو managerId)' };
      const res = await hrApi.updateDepartment(id, ctx.companyId, data, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل تعديل القسم' };
      return { updated: true, departmentId: id };
    },
  },

  // ─── WRITE: Delete department ────────────────────────────────────────────
  {
    name: 'hr.delete_department',
    labelAr: 'حذف قسم',
    descriptionAr: 'يحذف قسماً — يرفض النظام حذف قسم به موظفون مرتبطون ويطالب بنقلهم أولاً. استخدم search.departments أولاً.',
    permission: 'hr.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'معرف القسم (من search.departments) — إلزامي' },
      },
      required: ['id'],
    },
    summarizeArgs: (a) => `حذف قسم: ${String(a.id).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const id = str(args.id);
      if (!id) return { error: 'id مطلوب — استخدم search.departments أولاً' };
      const res = await hrApi.deleteDepartment(id, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف القسم' };
      return { deleted: true, departmentId: id };
    },
  },
];
