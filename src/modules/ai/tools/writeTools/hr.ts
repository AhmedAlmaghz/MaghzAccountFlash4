import type { ToolDefinition } from '../../types';
import { hrApi } from '@/modules/hr/api';
import { getNextDocumentNumber } from '@/core/api';
import {
  num,
  str,
} from './shared';

/**
 * WRITE tools — الموارد البشرية (11 أداة).
 * Split from the former monolithic writeTools.ts (Phase 77): identical
 * behaviour, smaller merge-conflict surface. Shared helpers in ./shared;
 * every tool stays behind its confirmation-card gate (dangerLevel:
 * 'write') with central audit logging in the tool executor.
 */
export const hrWriteTools: ToolDefinition[] = [
  // ─── ─── HR Employee ──────────────────────────────────────────────────────── ───
  {
    name: 'hr.create_employee',
    labelAr: 'إنشاء موظف',
    descriptionAr: 'ينشئ موظفاً جديداً بالاسم والراتب الأساسي وتاريخ التوظيف. استخدم search.employees أولاً للتأكد من عدم التكرار.',
    permission: 'hr.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        fullName: { type: 'string', description: 'الاسم الكامل (إلزامي)' },
        employeeNumber: { type: 'string', description: 'رقم الموظف (اختياري — يُولّد تلقائياً)' },
        nationalId: { type: 'string', description: 'الرقم الوطني' },
        phone: { type: 'string' },
        email: { type: 'string' },
        address: { type: 'string', description: 'العنوان' },
        position: { type: 'string', description: 'المسمى الوظيفي' },
        departmentId: { type: 'string', description: 'معرف القسم (اختياري — من search.departments)' },
        hireDate: { type: 'string', description: 'تاريخ التوظيف YYYY-MM-DD (إلزامي)' },
        baseSalary: { type: 'number', description: 'الراتب الأساسي (إلزامي)' },
      },
      required: ['fullName', 'hireDate', 'baseSalary'],
    },
    summarizeArgs: (a) => `إنشاء موظف: ${a.fullName} — راتب: ${a.baseSalary}`,
    execute: async (args, ctx) => {
      const fullName = str(args.fullName);
      if (!fullName) return { error: 'الاسم الكامل مطلوب' };
      const hireDate = str(args.hireDate);
      if (!hireDate) return { error: 'تاريخ التوظيف مطلوب' };
      const baseSalary = num(args.baseSalary);
      if (baseSalary <= 0) return { error: 'الراتب يجب أن يكون أكبر من صفر' };

      let empNumber = str(args.employeeNumber);
      if (!empNumber) {
        const seq = await getNextDocumentNumber(ctx.companyId, 'employee');
        if (!seq.success || !seq.number) return { error: seq.error || 'فشل توليد رقم الموظف' };
        empNumber = seq.number;
      }

      const res = await hrApi.createEmployee({
        companyId: ctx.companyId,
        employeeNumber: empNumber,
        fullName,
        nationalId: str(args.nationalId),
        phone: str(args.phone),
        email: str(args.email),
        address: str(args.address),
        departmentId: str(args.departmentId),
        position: str(args.position),
        grade: undefined,
        hireDate,
        terminationDate: undefined,
        baseSalary,
        isActive: true,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء الموظف' };
      return { created: true, employeeId: res.id, fullName, employeeNumber: empNumber };
    },
  },

  // ─── ─── HR: Create Payroll Run ───────────────────────────────────────── ───
  {
    name: 'hr.create_payroll_run',
    labelAr: 'إنشاء مسير رواتب',
    descriptionAr: 'ينشئ مسير رواتب كمسودة لشهر وسنة — النظام يحسب الأساسي والبدلات والاستقطاعات والأوفر تايم تلقائياً من بطاقات الموظفين ومكونات الرواتب وحضور الشهر، فلا ترسل قيم رواتب يدوية. فضّل hr.preview_payroll للمعاينة و hr.generate_payroll_run للإنشاء الذكي. استخدم search.employees أولاً لمعرفة الموظفين.',
    permission: 'hr.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        month: { type: 'number', description: 'الشهر (1-12)' },
        year: { type: 'number', description: 'السنة (مثال: 2026)' },
        employeeIds: {
          type: 'array',
          description: 'معرفات الموظفين (اختياري — عند حذفه يُضم كل الموظفين النشطين). احصل عليها من search.employees',
          items: { type: 'string', description: 'معرف الموظف (من search.employees)' },
        },
      },
      required: ['month', 'year'],
    },
    summarizeArgs: (a) => {
      const count = Array.isArray(a.employeeIds) ? a.employeeIds.length : null;
      return `إنشاء مسير رواتب لشهر ${a.month}/${a.year}${count !== null ? ` — ${count} موظف` : ' — كل الموظفين النشطين'}`;
    },
    execute: async (args, ctx) => {
      const month = num(args.month);
      const year = num(args.year);
      if (month < 1 || month > 12) return { error: 'الشهر يجب أن يكون بين 1 و 12' };
      if (year < 2000 || year > 2100) return { error: 'سنة غير صحيحة' };

      // Server recomputes every line from employee cards + components +
      // attendance — only employeeId matters per line.
      const rawIds = Array.isArray(args.employeeIds) ? args.employeeIds : [];
      const employeeIds = rawIds.map((v) => str(v)).filter((v): v is string => Boolean(v));

      let lines: Array<{ employeeId: string }>;
      if (employeeIds.length > 0) {
        lines = employeeIds.map((employeeId) => ({ employeeId }));
      } else {
        // No explicit list → all active employees (mirror of previewPayrollRun scope)
        const preview = await hrApi.previewPayrollRun(ctx.companyId, month, year);
        if (!preview.success || !preview.data) return { error: preview.error || 'فشل جلب الموظفين النشطين للمسير' };
        if (preview.data.lines.length === 0) return { error: 'لا يوجد موظفون نشطون لهذه الفترة' };
        lines = preview.data.lines.map((l) => ({ employeeId: l.employeeId }));
      }
      if (lines.length === 0) return { error: 'يجب تمرير موظف واحد على الأقل في employeeIds' };

      const res = await hrApi.createPayrollRun({
        companyId: ctx.companyId,
        month,
        year,
        status: 'draft',
        lines,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء مسير الرواتب' };
      return {
        created: true,
        payrollRunId: res.id,
        month,
        year,
        employeeCount: lines.length,
        status: 'draft',
        note: 'المسير مسودة بخطوط محسوبة تلقائياً — استخدم hr.post_payroll_run للترحيل',
      };
    },
  },

  // ─── ─── HR: Update Employee ────────────────────────────────────────── ───
  {
    name:     'hr.update_employee',
    labelAr: 'تعديل موظف',
    descriptionAr: 'يُعدّل بيانات موظف موجود (الاسم، الهاتف، البريد، القسم، المسمى الوظيفي، الراتب الأساسي، الحالة). لربط القسم استخدم departmentId من search.departments. استخدم search.employees أولاً.',
    permission: 'hr.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: 'معرف الموظف (من search.employees)' },
        fullName: { type: 'string', description: 'الاسم الكامل' },
        phone: { type: 'string' },
        email: { type: 'string' },
        position: { type: 'string', description: 'المسمى الوظيفي' },
        departmentId: { type: 'string', description: 'معرف القسم (من search.departments)' },
        baseSalary: { type: 'number', description: 'الراتب الأساسي الشهري' },
        isActive: { type: 'boolean', description: 'نشط/معطّل — التعطيل هو البديل الآمن للحذف' },
      },
      required: ['employeeId'],
    },
    summarizeArgs: (a) => `تعديل موظف: ${String(a.employeeId).slice(0, 8)}…${a.fullName ? ` — ${a.fullName}` : ''}${a.departmentId ? ' (ربط بقسم)' : ''}`,
    execute: async (args, ctx) => {
      const employeeId = str(args.employeeId);
      if (!employeeId) return { error: 'employeeId مطلوب — استخدم search.employees أولاً' };
      const data: Record<string, unknown> = {};
      if (args.fullName !== undefined) data.fullName = str(args.fullName);
      if (args.phone !== undefined) data.phone = str(args.phone);
      if (args.email !== undefined) data.email = str(args.email);
      if (args.position !== undefined) data.position = str(args.position);
      if (args.departmentId !== undefined) data.departmentId = str(args.departmentId) || undefined;
      if (args.baseSalary !== undefined) {
        const salary = num(args.baseSalary);
        if (salary <= 0) return { error: 'الراتب يجب أن يكون أكبر من صفر' };
        data.baseSalary = salary;
      }
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await hrApi.updateEmployee(employeeId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل الموظف' };
      return { updated: true, employeeId, ...data };
    },
  },

  // ─── ─── HR: Delete Employee ────────────────────────────────────────── ───
  {
    name: 'hr.delete_employee',
    labelAr: 'حذف موظف',
    descriptionAr: 'يحذف موظفاً من النظام — يرفض النظام حذف موظف له سجل (رواتب/إجازات/حضور) ويطلب تعطيله بدلاً من ذلك. استخدم search.employees أولاً.',
    permission: 'hr.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: 'معرف الموظف (من search.employees)' },
      },
      required: ['employeeId'],
    },
    summarizeArgs: (a) => `حذف موظف: ${String(a.employeeId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const employeeId = str(args.employeeId);
      if (!employeeId) return { error: 'employeeId مطلوب — استخدم search.employees أولاً' };
      const res = await hrApi.deleteEmployee(employeeId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف الموظف (قد يكون له سجلات — عطّله بدلاً من ذلك)' };
      return { deleted: true, employeeId };
    },
  },

  // ─── ─── HR: Create Leave ───────────────────────────────────────────── ───
  {
    name: 'hr.create_leave',
    labelAr: 'طلب إجازة',
    descriptionAr: 'ينشئ طلب إجازة لموظف بنوع الإجازة وتاريخي البداية والنهاية — النظام يحسب عدد الأيام ويرفض التداخل مع إجازة قائمة. استخدم search.employees أولاً.',
    permission: 'hr.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: 'معرف الموظف (من search.employees) — إلزامي' },
        leaveType: { type: 'string', enum: ['annual', 'sick', 'emergency', 'unpaid'], description: 'نوع الإجازة (إلزامي)' },
        startDate: { type: 'string', description: 'تاريخ البداية YYYY-MM-DD (إلزامي)' },
        endDate: { type: 'string', description: 'تاريخ النهاية YYYY-MM-DD (إلزامي)' },
        reason: { type: 'string', description: 'سبب الإجازة' },
      },
      required: ['employeeId', 'leaveType', 'startDate', 'endDate'],
    },
    summarizeArgs: (a) => `طلب إجازة ${a.leaveType} للموظف ${a.employeeId} من ${a.startDate} إلى ${a.endDate}`,
    execute: async (args, ctx) => {
      const employeeId = str(args.employeeId);
      const leaveType = str(args.leaveType) as 'annual' | 'sick' | 'emergency' | 'unpaid' | undefined;
      const startDate = str(args.startDate);
      const endDate = str(args.endDate);
      if (!employeeId) return { error: 'employeeId مطلوب — استخدم search.employees أولاً' };
      if (!leaveType || !['annual', 'sick', 'emergency', 'unpaid'].includes(leaveType)) return { error: 'نوع إجازة غير صحيح' };
      if (!startDate) return { error: 'تاريخ البداية مطلوب' };
      if (!endDate) return { error: 'تاريخ النهاية مطلوب' };
      // Days are computed SERVER-side (overlap + reversed-range guards included)
      const res = await hrApi.createLeave({
        companyId: ctx.companyId,
        employeeId,
        leaveType,
        startDate,
        endDate,
        reason: str(args.reason),
        status: 'pending' as const,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء طلب الإجازة' };
      return { created: true, leaveId: res.id, employeeId, leaveType, startDate, endDate, days: res.days };
    },
  },

  // ─── ─── HR: Update Leave ───────────────────────────────────────────── ───
  {
    name: 'hr.update_leave',
    labelAr: 'تحديث طلب إجازة',
    descriptionAr: 'يُحدّث حالة طلب إجازة (موافقة/رفض/إلغاء). قبل الموافقة تحقق من الرصيد بـ hr.get_leave_balances — النظام يرفض الاعتماد عند تجاوز الرصيد ويعرض المتبقي. استخدم search.leaves أولاً.',
    permission: 'hr.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        leaveId: { type: 'string', description: 'معرف طلب الإجازة (من search.leaves)' },
        status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'cancelled'], description: 'الحالة الجديدة (اختياري)' },
        reason: { type: 'string', description: 'سبب التحديث (اختياري)' },
      },
      required: ['leaveId'],
    },
    summarizeArgs: (a) => `تحديث طلب إجازة: ${String(a.leaveId).slice(0, 8)}…${a.status ? ` ← ${a.status}` : ''}`,
    execute: async (args, ctx) => {
      const leaveId = str(args.leaveId);
      if (!leaveId) return { error: 'leaveId مطلوب — استخدم search.leaves أولاً' };
      const status = str(args.status) as 'pending' | 'approved' | 'rejected' | 'cancelled' | undefined;
      if (status && !['pending', 'approved', 'rejected', 'cancelled'].includes(status)) return { error: 'حالة غير صحيحة' };
      if (!status && args.reason === undefined) return { error: 'يجب تمرير status أو reason على الأقل' };
      if (status) {
        const res = await hrApi.updateLeaveStatus(leaveId, ctx.companyId, status, ctx.userId);
        if (!res.success) return { error: res.error || 'فشل تحديث الإجازة' };
      }
      return { updated: true, leaveId, status: status || undefined };
    },
  },

  // ─── ─── HR: Delete Leave ───────────────────────────────────────────── ───
  {
    name: 'hr.delete_leave',
    labelAr: 'حذف طلب إجازة',
    descriptionAr: 'يحذف طلب إجازة من النظام — الطلبات المعتمدة لا تُحذف (تُلغى عبر hr.update_leave بحالة cancelled). استخدم search.leaves أولاً.',
    permission: 'hr.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        leaveId: { type: 'string', description: 'معرف طلب الإجازة (من search.leaves)' },
      },
      required: ['leaveId'],
    },
    summarizeArgs: (a) => `حذف طلب إجازة: ${String(a.leaveId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const leaveId = str(args.leaveId);
      if (!leaveId) return { error: 'leaveId مطلوب — استخدم search.leaves أولاً' };
      const res = await hrApi.deleteLeave(leaveId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف الإجازة (المعتمدة تُلغى ولا تُحذف)' };
      return { deleted: true, leaveId };
    },
  },

  // ─── ─── HR: Post Payroll Run ───────────────────────────────────────── ───
  {
    name: 'hr.post_payroll_run',
    labelAr: 'ترحيل مسير رواتب',
    descriptionAr: 'يُرحّل مسير رواتب من حالة مسودة (draft) إلى مرحّلة (posted) ويُنشئ القيد المحاسبي إجمالياً تلقائياً. يرفض ترحيل غير المسودات. استخدم search.payroll_runs أولاً.',
    permission: 'hr.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        payrollRunId: { type: 'string', description: 'معرف مسير الرواتب (من search.payroll_runs)' },
      },
      required: ['payrollRunId'],
    },
    summarizeArgs: (a) => `ترحيل مسير رواتب: ${String(a.payrollRunId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const payrollRunId = str(args.payrollRunId);
      if (!payrollRunId) return { error: 'payrollRunId مطلوب — استخدم search.payroll_runs أولاً' };
      const res = await hrApi.postPayrollRun(payrollRunId, ctx.companyId, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل ترحيل مسير الرواتب' };
      return {
        posted: true,
        payrollRunId,
        runNumber: res.runNumber,
        note: res.runNumber ? `تم ترحيل المسير ورقمه ${res.runNumber} — حُجز القيد المحاسبي إجمالياً` : 'تم ترحيل المسير وحجز القيد المحاسبي إجمالياً',
      };
    },
  },

  // ─── ─── HR: Create End of Service ──────────────────────────────────── ───
  {
    name: 'hr.create_end_of_service',
    labelAr: 'إنشاء حساب نهاية خدمة',
    descriptionAr: 'ينشئ حساب نهاية خدمة لموظف بتاريخ انتهاء وسبب — النظام يحسب سنوات الخدمة والمبلغ من بطاقة الموظف تلقائياً، فلا ترسل قيماً محسوبة. استخدم search.employees أولاً و hr.preview_end_of_service للمعاينة.',
    permission: 'hr.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: 'معرف الموظف (من search.employees) — إلزامي' },
        terminationDate: { type: 'string', description: 'تاريخ الانتهاء YYYY-MM-DD (إلزامي)' },
        reason: { type: 'string', enum: ['resignation', 'termination', 'contract_end', 'retirement'], description: 'سبب إنهاء الخدمة (افتراضي resignation)' },
        notes: { type: 'string', description: 'ملاحظات (اختياري)' },
      },
      required: ['employeeId', 'terminationDate'],
    },
    summarizeArgs: (a) => `إنشاء حساب نهاية خدمة للموظف ${a.employeeId} — تاريخ: ${a.terminationDate}`,
    execute: async (args, ctx) => {
      const employeeId = str(args.employeeId);
      const terminationDate = str(args.terminationDate);
      if (!employeeId) return { error: 'employeeId مطلوب — استخدم search.employees أولاً' };
      if (!terminationDate) return { error: 'تاريخ الانتهاء مطلوب' };
      const reason = (str(args.reason) || 'resignation') as 'resignation' | 'termination' | 'contract_end' | 'retirement';
      if (!['resignation', 'termination', 'contract_end', 'retirement'].includes(reason)) return { error: 'سبب إنهاء خدمة غير صحيح' };
      // Server computes serviceYears/lastSalary/eosAmount — send ONLY the raw inputs.
      const res = await hrApi.createEndOfService({
        companyId: ctx.companyId,
        employeeId,
        terminationDate,
        reason,
        status: 'draft',
        notes: str(args.notes),
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء حساب نهاية الخدمة' };
      return { created: true, endOfServiceId: res.id, employeeId, terminationDate, eosAmount: res.eosAmount, serviceYears: res.serviceYears };
    },
  },

  // ─── ─── HR: Delete End of Service ──────────────────────────────────── ───
  {
    name: 'hr.delete_end_of_service',
    labelAr: 'حذف حساب نهاية خدمة',
    descriptionAr: 'يحذف حساب نهاية خدمة (المسودات فقط). استخدم search.end_of_services أولاً.',
    permission: 'hr.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        endOfServiceId: { type: 'string', description: 'معرف حساب نهاية الخدمة (من search.end_of_services)' },
      },
      required: ['endOfServiceId'],
    },
    summarizeArgs: (a) => `حذف حساب نهاية خدمة: ${String(a.endOfServiceId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const endOfServiceId = str(args.endOfServiceId);
      if (!endOfServiceId) return { error: 'endOfServiceId مطلوب — استخدم search.end_of_services أولاً' };
      const res = await hrApi.deleteEndOfService(endOfServiceId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف حساب نهاية الخدمة' };
      return { deleted: true, endOfServiceId };
    },
  },

  // ─── ─── HR: Update End of Service Status ────────────────────────────── ───
  {
    name: 'hr.update_end_of_service_status',
    labelAr: 'تحديث حالة نهاية خدمة',
    descriptionAr: 'يغيّر حالة حساب نهاية خدمة (draft → approved يُنشئ قيد الاستحقاق، أو cancelled). الدفع لا يتم هنا — استخدم hr.pay_end_of_service مع خزنة من search.cash_boxes. استخدم search.end_of_services أولاً.',
    permission: 'hr.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        endOfServiceId: { type: 'string', description: 'معرف حساب نهاية الخدمة (من search.end_of_services)' },
        status: { type: 'string', enum: ['draft', 'approved', 'cancelled'], description: 'الحالة الجديدة (الدفع عبر hr.pay_end_of_service)' },
      },
      required: ['endOfServiceId', 'status'],
    },
    summarizeArgs: (a) => `تحديث حالة نهاية خدمة إلى: ${a.status}`,
    execute: async (args, ctx) => {
      const endOfServiceId = str(args.endOfServiceId);
      const status = str(args.status) as 'draft' | 'approved' | 'cancelled';
      if (!endOfServiceId) return { error: 'endOfServiceId مطلوب — استخدم search.end_of_services أولاً' };
      if (!status || !['draft', 'approved', 'cancelled'].includes(status)) return { error: 'حالة غير صحيحة — الدفع يتم عبر hr.pay_end_of_service' };
      const res = await hrApi.updateEndOfServiceStatus(endOfServiceId, ctx.companyId, status, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل تحديث الحالة' };
      return { updated: true, endOfServiceId, status };
    },
  },
];
