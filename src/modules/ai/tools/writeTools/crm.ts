import type { ToolDefinition } from '../../types';
import { salesApi } from '@/modules/sales/api';
import { getNextDocumentNumber } from '@/core/api';
import { crmApi } from '@/modules/crm/api';
import {
  num,
  str,
} from './shared';
import { localToday } from '../../engine/dateUtils';

/**
 * WRITE tools — علاقات العملاء (19 أداة).
 * Split from the former monolithic writeTools.ts (Phase 77): identical
 * behaviour, smaller merge-conflict surface. Shared helpers in ./shared;
 * every tool stays behind its confirmation-card gate (dangerLevel:
 * 'write') with central audit logging in the tool executor.
 */

function today(): string {
  // LOCAL calendar day — UTC "today" is yesterday for GMT+3 between 00:00-03:00
  return localToday();
}
export const crmWriteTools: ToolDefinition[] = [
  // ─── ─── CRM ───────────────────────────────────────────────────────────────── ───
  {
    name: 'crm.create_lead',
    labelAr: 'إنشاء عميل محتمل',
    descriptionAr: 'ينشئ عميلاً محتملاً (lead) جديداً بالاسم وبيانات اختيارية.',
    permission: 'crm.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم العميل المحتمل (إلزامي)' },
        phone: { type: 'string' },
        company: { type: 'string', description: 'اسم الشركة' },
        source: { type: 'string', description: 'مصدر العميل' },
        estimatedValue: { type: 'number', description: 'القيمة المتوقعة' },
      },
      required: ['name'],
    },
    summarizeArgs: (a) => `إنشاء عميل محتمل: ${a.name}`,
    execute: async (args, ctx) => {
      const name = str(args.name);
      if (!name) return { error: 'الاسم مطلوب' };
      const res = await crmApi.createLead({
        companyId: ctx.companyId,
        name,
        phone: str(args.phone),
        company: str(args.company),
        source: str(args.source),
        estimatedValue: args.estimatedValue !== undefined ? num(args.estimatedValue) : undefined,
        status: 'new',
        rating: 'warm',
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء العميل المحتمل' };
      return { created: true, leadId: res.id, name };
    },
  },

  {
    name: 'crm.create_opportunity',
    labelAr: 'إنشاء فرصة بيعية',
    descriptionAr: 'ينشئ فرصة بيعية جديدة بالاسم والقيمة، ويمكن ربطها بعميل محتمل أو عميل.',
    permission: 'crm.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم الفرصة (إلزامي)' },
        value: { type: 'number', description: 'قيمة الفرصة' },
        leadId: { type: 'string', description: 'معرف عميل محتمل (اختياري)' },
        customerId: { type: 'string', description: 'معرف عميل (اختياري)' },
        probability: { type: 'number', description: 'نسبة النجاح 0-100 (اختياري)' },
      },
      required: ['name', 'value'],
    },
    summarizeArgs: (a) => `إنشاء فرصة بيعية: ${a.name} — القيمة: ${a.value}`,
    execute: async (args, ctx) => {
      const name = str(args.name);
      if (!name) return { error: 'اسم الفرصة مطلوب' };
      const res = await crmApi.createOpportunity({
        companyId: ctx.companyId,
        name,
        value: num(args.value),
        stage: 'new',
        probability: args.probability !== undefined ? num(args.probability) : undefined,
        leadId: str(args.leadId) || undefined,
        customerId: str(args.customerId) || undefined,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء الفرصة' };
      return { created: true, opportunityId: res.id, name };
    },
  },

  {
    name: 'crm.create_task',
    labelAr: 'إنشاء مهمة',
    descriptionAr: 'ينشئ مهمة جديدة بعنوان وتاريخ استحقاق وأولوية اختيارية.',
    permission: 'crm.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'عنوان المهمة (إلزامي)' },
        dueDate: { type: 'string', description: 'تاريخ الاستحقاق YYYY-MM-DD (اختياري)' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'الأولوية (افتراضي medium)' },
        description: { type: 'string' },
      },
      required: ['title'],
    },
    summarizeArgs: (a) => `إنشاء مهمة: ${a.title}${a.dueDate ? ` — تستحق ${a.dueDate}` : ''}`,
    execute: async (args, ctx) => {
      const title = str(args.title);
      if (!title) return { error: 'عنوان المهمة مطلوب' };
      const priority = str(args.priority);
      if (priority && !['low', 'medium', 'high'].includes(priority)) return { error: 'أولوية غير صحيحة' };
      const res = await crmApi.createTask({
        companyId: ctx.companyId,
        title,
        description: str(args.description),
        dueDate: str(args.dueDate),
        priority: (priority as 'low' | 'medium' | 'high') || 'medium',
        status: 'pending',
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء المهمة' };
      return { created: true, taskId: res.id, title };
    },
  },

  // ─── ─── CRM Activity ────────────────────────────────────────────────────── ───
  {
    name: 'crm.create_activity',
    labelAr: 'تسجيل نشاط',
    descriptionAr: 'يسجّل نشاطاً جديداً (اتصال، بريد، اجتماع) ويمكن ربطه بعميل محتمل أو عميل.',
    permission: 'crm.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['call', 'meeting', 'email', 'visit', 'note'], description: 'نوع النشاط (افتراضي note)' },
        subject: { type: 'string', description: 'عنوان النشاط (إلزامي)' },
        description: { type: 'string', description: 'وصف النشاط' },
        activityDate: { type: 'string', description: 'تاريخ النشاط YYYY-MM-DD (افتراضي اليوم)' },
        durationMinutes: { type: 'number', description: 'المدة بالدقائق' },
        leadId: { type: 'string', description: 'معرف العميل المحتمل (اختياري — من crm.get_leads)' },
        opportunityId: { type: 'string', description: 'معرف الفرصة البيعية (اختياري)' },
        customerId: { type: 'string', description: 'معرف العميل (اختياري — من search.customers)' },
      },
      required: ['subject'],
    },
    summarizeArgs: (a) => `تسجيل نشاط: ${a.subject} (${a.type || 'note'})${a.leadId ? ' — مرتبط بعميل محتمل' : ''}`,
    execute: async (args, ctx) => {
      const subject = str(args.subject);
      if (!subject) return { error: 'عنوان النشاط مطلوب' };
      const activityType = str(args.type) || 'note';
      if (!['call', 'meeting', 'email', 'visit', 'note'].includes(activityType)) return { error: 'نوع نشاط غير صحيح' };

      const res = await crmApi.createActivity({
        companyId: ctx.companyId,
        type: activityType as 'call' | 'meeting' | 'email' | 'visit' | 'note',
        subject,
        description: str(args.description),
        activityDate: str(args.activityDate) || today(),
        durationMinutes: args.durationMinutes !== undefined ? num(args.durationMinutes) : undefined,
        leadId: str(args.leadId),
        opportunityId: str(args.opportunityId),
        customerId: str(args.customerId),
      });
      if (!res.success) return { error: res.error || 'فشل تسجيل النشاط' };
      return { created: true, activityId: res.id, subject, type: activityType };
    },
  },

  // ─── ─── CRM Lead Status Update ──────────────────────────────────────────── ───
  {
    name: 'crm.update_lead_status',
    labelAr: 'تحديث حالة عميل محتمل',
    descriptionAr: 'يُحدّث حالة عميل محتمل (مثلاً إلى contacted/qualified/lost). استخدم crm.get_leads أولاً.',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        leadId: { type: 'string', description: 'معرف العميل المحتمل (من crm.get_leads)' },
        status: { type: 'string', enum: ['new', 'contacted', 'qualified', 'converted', 'lost'], description: 'الحالة الجديدة' },
        rating: { type: 'string', enum: ['hot', 'warm', 'cold'], description: 'التقييم (اختياري)' },
        notes: { type: 'string', description: 'ملاحظات' },
      },
      required: ['leadId', 'status'],
    },
    summarizeArgs: (a) => `تحديث حالة عميل محتمل إلى: ${a.status}`,
    execute: async (args, ctx) => {
      const leadId = str(args.leadId);
      const status = str(args.status);
      if (!leadId) return { error: 'leadId مطلوب' };
      if (!status || !['new', 'contacted', 'qualified', 'converted', 'lost'].includes(status)) return { error: 'حالة غير صحيحة' };
      const data: Record<string, unknown> = { status };
      const rating = str(args.rating);
      if (rating && ['hot', 'warm', 'cold'].includes(rating)) data.rating = rating;
      if (args.notes !== undefined) data.notes = str(args.notes);

      const res = await crmApi.updateLead(leadId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تحديث الحالة' };
      return { updated: true, leadId, status };
    },
  },

  // ─── ─── CRM Opportunity Stage Update ────────────────────────────────────── ───
  {
    name: 'crm.update_opportunity_stage',
    labelAr: 'تحديث مرحلة فرصة بيعية',
    descriptionAr: 'يُحدّث مرحلة فرصة بيعية (مثلاً إلى won/lost/proposal). استخدم crm.get_opportunities أولاً.',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'معرف الفرصة (من crm.get_opportunities)' },
        stage: { type: 'string', enum: ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'], description: 'المرحلة الجديدة' },
        probability: { type: 'number', description: 'نسبة النجاح 0-100 (اختياري)' },
        notes: { type: 'string', description: 'ملاحظات' },
      },
      required: ['opportunityId', 'stage'],
    },
    summarizeArgs: (a) => `تحديث مرحلة فرصة بيعية إلى: ${a.stage}`,
    execute: async (args, ctx) => {
      const opportunityId = str(args.opportunityId);
      const stage = str(args.stage);
      if (!opportunityId) return { error: 'opportunityId مطلوب' };
      if (!stage || !['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'].includes(stage)) return { error: 'مرحلة غير صحيحة' };
      const data: Record<string, unknown> = { stage };
      if (args.probability !== undefined) {
        const prob = num(args.probability);
        if (prob < 0 || prob > 100) return { error: 'نسبة النجاح يجب أن تكون بين 0 و 100' };
        data.probability = prob;
      }
      if (args.notes !== undefined) data.notes = str(args.notes);

      const res = await crmApi.updateOpportunity(opportunityId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تحديث المرحلة' };
      return { updated: true, opportunityId, stage };
    },
  },

  // ─── ─── CRM: Update Activity (Phase C2 — completes the CRUD triad) ──────── ───
  {
    name: 'crm.update_activity',
    labelAr: 'تعديل نشاط',
    descriptionAr: 'يُعدّل نشاطاً مسجلاً (النوع، العنوان، الوصف، التاريخ، المدة). استخدم search.activities أولاً لإيجاد activityId.',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        activityId: { type: 'string', description: 'معرف النشاط (من search.activities)' },
        type: { type: 'string', enum: ['call', 'meeting', 'email', 'visit', 'note'], description: 'نوع النشاط' },
        subject: { type: 'string', description: 'عنوان النشاط' },
        description: { type: 'string', description: 'وصف النشاط' },
        activityDate: { type: 'string', description: 'تاريخ النشاط YYYY-MM-DD' },
        durationMinutes: { type: 'number', description: 'المدة بالدقائق' },
      },
      required: ['activityId'],
    },
    summarizeArgs: (a) => `تعديل نشاط ${a.activityId}${a.subject ? `: ${a.subject}` : ''}`,
    execute: async (args, ctx) => {
      const activityId = str(args.activityId);
      if (!activityId) return { error: 'activityId مطلوب' };
      const data: Record<string, unknown> = {};
      const type = str(args.type);
      if (type) {
        if (!['call', 'meeting', 'email', 'visit', 'note'].includes(type)) return { error: 'نوع نشاط غير صحيح' };
        data.type = type;
      }
      if (args.subject !== undefined) {
        const subject = str(args.subject);
        if (!subject) return { error: 'عنوان النشاط لا يمكن أن يكون فارغاً' };
        data.subject = subject;
      }
      if (args.description !== undefined) data.description = str(args.description);
      if (args.activityDate !== undefined) data.activityDate = str(args.activityDate);
      if (args.durationMinutes !== undefined) data.durationMinutes = num(args.durationMinutes);
      if (Object.keys(data).length === 0) return { error: 'لا توجد حقول للتعديل' };

      const res = await crmApi.updateActivity(activityId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل النشاط' };
      return { updated: true, activityId };
    },
  },

  // ─── ─── CRM: Complete Task (Phase C2 — ergonomic shortcut) ──────────────── ───
  {
    name: 'crm.complete_task',
    labelAr: 'إكمال مهمة',
    descriptionAr: 'يضع مهمة كمنجزة (status=completed). اختصار مهني لإنجاز مهام المتابعة. استخدم search.tasks أولاً لإيجاد taskId.',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'معرف المهمة (من search.tasks)' },
        notes: { type: 'string', description: 'ملاحظات الإنجاز (اختياري)' },
      },
      required: ['taskId'],
    },
    summarizeArgs: (a) => `إكمال المهمة ${a.taskId}`,
    execute: async (args, ctx) => {
      const taskId = str(args.taskId);
      if (!taskId) return { error: 'taskId مطلوب' };
      const data: Record<string, unknown> = { status: 'completed' };
      if (args.notes !== undefined) data.description = str(args.notes);

      const res = await crmApi.updateTask(taskId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل إكمال المهمة' };
      return { updated: true, taskId, status: 'completed' };
    },
  },

  // ─── ─── CRM: Win Opportunity (Phase C2 — guided close, no auto-invoice) ──── ───
  {
    name: 'crm.win_opportunity',
    labelAr: 'الفوز بفرصة بيعية',
    descriptionAr: 'يقفل فرصة كـ won (يختم close_date واحتمالية 100%) ثم يرشد لخطوة الفاتورة. لا ينشئ فاتورة تلقائياً — اسأل المستخدم أولاً. استخدم crm.get_opportunities أولاً.',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'معرف الفرصة (من crm.get_opportunities)' },
        notes: { type: 'string', description: 'ملاحظات الإغلاق (اختياري)' },
      },
      required: ['opportunityId'],
    },
    summarizeArgs: (a) => `الفوز بالفرصة ${a.opportunityId} (قفل won)`,
    execute: async (args, ctx) => {
      const opportunityId = str(args.opportunityId);
      if (!opportunityId) return { error: 'opportunityId مطلوب' };

      const data: Record<string, unknown> = { stage: 'won' };
      if (args.notes !== undefined) data.notes = str(args.notes);
      const res = await crmApi.updateOpportunity(opportunityId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل إقفال الفرصة' };

      // Guidance, not automation — the invoice decision belongs to the user.
      const oppRes = await crmApi.getOpportunityById(opportunityId, ctx.companyId);
      const opp = oppRes.success ? oppRes.data : undefined;
      return {
        updated: true,
        opportunityId,
        stage: 'won',
        closeDate: opp?.closeDate,
        value: opp?.value,
        customerId: opp?.customerId,
        nextStep: 'تم الفوز بالفرصة. اسأل المستخدم: "هل تريد إنشاء فاتورة مبيعات لهذه الفرصة؟" — عند الموافقة استخدم sales.create_invoice مع customerId وقيمة الفرصة.',
      };
    },
  },

  // ─── ─── CRM: Update Lead (General) ───────────────────────────────────── ───
  {
    name: 'crm.update_lead',
    labelAr: 'تعديل عميل محتمل',
    descriptionAr: 'يُعدّل بيانات عميل محتمل (lead): الاسم، الهاتف، البريد، القيمة المتوقعة، الملاحظات، التقييم، الحالة، المسؤول. استخدم search.leads أولاً.',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        leadId: { type: 'string', description: 'معرف العميل المحتمل (UUID)' },
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        estimatedValue: { type: 'number' },
        notes: { type: 'string' },
        rating: { type: 'string', enum: ['hot', 'warm', 'cold'] },
        status: { type: 'string', enum: ['new', 'contacted', 'qualified', 'converted', 'lost'] },
      },
      required: ['leadId'],
    },
    summarizeArgs: (a) => `تعديل عميل محتمل: ${a.leadId}`,
    execute: async (args, ctx) => {
      const leadId = str(args.leadId);
      if (!leadId) return { error: 'leadId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.name !== undefined) data.name = str(args.name);
      if (args.phone !== undefined) data.phone = str(args.phone);
      if (args.email !== undefined) data.email = str(args.email);
      if (args.estimatedValue !== undefined) data.estimatedValue = num(args.estimatedValue);
      if (args.notes !== undefined) data.notes = str(args.notes);
      if (args.rating !== undefined) data.rating = str(args.rating);
      if (args.status !== undefined) data.status = str(args.status);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل' };
      const res = await crmApi.updateLead(leadId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل العميل المحتمل' };
      return { updated: true, leadId, ...data };
    },
  },

  // ─── ─── CRM: Update Opportunity (General) ────────────────────────────── ───
  {
    name: 'crm.update_opportunity',
    labelAr: 'تعديل فرصة بيعية',
    descriptionAr: 'يُعدّل بيانات فرصة بيعية (الاسم، القيمة، المرحلة، نسبة النجاح، الملاحظات، المسؤول). استخدم search.opportunities أولاً.',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'معرف الفرصة (UUID)' },
        name: { type: 'string' },
        value: { type: 'number' },
        stage: { type: 'string', enum: ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] },
        probability: { type: 'number', description: 'نسبة النجاح 0-100' },
        notes: { type: 'string' },
      },
      required: ['opportunityId'],
    },
    summarizeArgs: (a) => `تعديل فرصة بيعية: ${a.opportunityId}`,
    execute: async (args, ctx) => {
      const opportunityId = str(args.opportunityId);
      if (!opportunityId) return { error: 'opportunityId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.name !== undefined) data.name = str(args.name);
      if (args.value !== undefined) data.value = num(args.value);
      if (args.stage !== undefined) data.stage = str(args.stage);
      if (args.probability !== undefined) {
        const prob = num(args.probability);
        if (prob < 0 || prob > 100) return { error: 'نسبة النجاح بين 0 و 100' };
        data.probability = prob;
      }
      if (args.notes !== undefined) data.notes = str(args.notes);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل' };
      const res = await crmApi.updateOpportunity(opportunityId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل الفرصة' };
      return { updated: true, opportunityId, ...data };
    },
  },

  // ─── ─── CRM: Update Task ─────────────────────────────────────────────── ───
  {
    name: 'crm.update_task',
    labelAr: 'تعديل مهمة',
    descriptionAr: 'يُعدّل بيانات مهمة (title, dueDate, priority, status, assignedTo).',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'معرف المهمة (UUID)' },
        title: { type: 'string' },
        dueDate: { type: 'string', description: 'تاريخ الاستحقاق YYYY-MM-DD' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
        notes: { type: 'string' },
      },
      required: ['taskId'],
    },
    summarizeArgs: (a) => `تعديل مهمة: ${a.title || a.taskId}`,
    execute: async (args, ctx) => {
      const taskId = str(args.taskId);
      if (!taskId) return { error: 'taskId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.title !== undefined) data.title = str(args.title);
      if (args.dueDate !== undefined) data.dueDate = String(args.dueDate);
      if (args.priority !== undefined) data.priority = str(args.priority);
      if (args.status !== undefined) data.status = str(args.status);
      if (args.notes !== undefined) data.notes = str(args.notes);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل' };
      const res = await crmApi.updateTask(taskId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل المهمة' };
      return { updated: true, taskId, ...data };
    },
  },

  // ─── ─── CRM: Delete Task ─────────────────────────────────────────────── ───
  {
    name: 'crm.delete_task',
    labelAr: 'حذف مهمة',
    descriptionAr: 'يحذف مهمة من نظام CRM.',
    permission: 'crm.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'معرف المهمة (UUID)' },
      },
      required: ['taskId'],
    },
    summarizeArgs: (a) => `حذف مهمة: ${a.taskId}`,
    execute: async (args, ctx) => {
      const taskId = str(args.taskId);
      if (!taskId) return { error: 'taskId مطلوب' };
      const res = await crmApi.deleteTask(taskId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف المهمة' };
      return { deleted: true, taskId };
    },
  },

  // ─── ─── CRM: Delete Lead ───────────────────────────────────────────── ───
  {
    name: 'crm.delete_lead',
    labelAr: 'حذف عميل محتمل',
    descriptionAr: 'يحذف عميلاً محتملاً (lead) من نظام CRM. استخدم crm.get_leads أولاً.',
    permission: 'crm.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        leadId: { type: 'string', description: 'معرف العميل المحتمل (من crm.get_leads)' },
      },
      required: ['leadId'],
    },
    summarizeArgs: (a) => `حذف عميل محتمل: ${String(a.leadId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const leadId = str(args.leadId);
      if (!leadId) return { error: 'leadId مطلوب — استخدم crm.get_leads أولاً' };
      const res = await crmApi.deleteLead(leadId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف العميل المحتمل' };
      return { deleted: true, leadId };
    },
  },

  // ─── ─── CRM: Delete Opportunity ────────────────────────────────────── ───
  {
    name: 'crm.delete_opportunity',
    labelAr: 'حذف فرصة بيعية',
    descriptionAr: 'يحذف فرصة بيعية من نظام CRM. استخدم crm.get_opportunities أولاً.',
    permission: 'crm.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'معرف الفرصة (من crm.get_opportunities)' },
      },
      required: ['opportunityId'],
    },
    summarizeArgs: (a) => `حذف فرصة بيعية: ${String(a.opportunityId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const opportunityId = str(args.opportunityId);
      if (!opportunityId) return { error: 'opportunityId مطلوب — استخدم crm.get_opportunities أولاً' };
      const res = await crmApi.deleteOpportunity(opportunityId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف الفرصة' };
      return { deleted: true, opportunityId };
    },
  },

  // ─── ─── CRM: Delete Activity ───────────────────────────────────────── ───
  {
    name: 'crm.delete_activity',
    labelAr: 'حذف نشاط',
    descriptionAr: 'يحذف نشاطاً من نظام CRM. استخدم crm.get_activities أولاً.',
    permission: 'crm.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        activityId: { type: 'string', description: 'معرف النشاط (من crm.get_activities)' },
      },
      required: ['activityId'],
    },
    summarizeArgs: (a) => `حذف نشاط: ${String(a.activityId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const activityId = str(args.activityId);
      if (!activityId) return { error: 'activityId مطلوب — استخدم crm.get_activities أولاً' };
      const res = await crmApi.deleteActivity(activityId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف النشاط' };
      return { deleted: true, activityId };
    },
  },

  // ─── ─── CRM: Create Customer ───────────────────────────────────────── ───
  {
    name: 'crm.create_customer',
    labelAr: 'إنشاء عميل',
    descriptionAr: 'ينشئ عميلاً جديداً بالاسم وبيانات اختيارية (هاتف، بريد، عنوان، رقم ضريبي).',
    permission: 'crm.create',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم العميل (إلزامي)' },
        phone: { type: 'string' },
        email: { type: 'string' },
        address: { type: 'string' },
        taxNumber: { type: 'string', description: 'الرقم الضريبي' },
      },
      required: ['name'],
    },
    summarizeArgs: (a) => `إنشاء عميل جديد: ${a.name}`,
    execute: async (args, ctx) => {
      const name = str(args.name);
      if (!name) return { error: 'اسم العميل مطلوب' };
      const docNumber = await getNextDocumentNumber(ctx.companyId, 'customer');
      if (!docNumber.success || !docNumber.number) return { error: docNumber.error || 'فشل توليد كود العميل' };
      const code = docNumber.number;
      const res = await salesApi.createCustomer({
        companyId: ctx.companyId,
        name,
        code,
        phone: str(args.phone),
        email: str(args.email),
        address: str(args.address),
        taxNumber: str(args.taxNumber),
        balance: 0,
        isActive: true,
      });
      if (!res.success) return { error: res.error || 'فشل إنشاء العميل' };
      return { created: true, customerId: res.id, name, code };
    },
  },

  // ─── ─── CRM: Update Customer ───────────────────────────────────────── ───
  {
    name: 'crm.update_customer',
    labelAr: 'تعديل عميل',
    descriptionAr: 'يُعدّل بيانات عميل موجود تحت وحدة CRM. استخدم search.customers أولاً.',
    permission: 'crm.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'معرف العميل (UUID)' },
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        address: { type: 'string' },
        isActive: { type: 'boolean' },
      },
      required: ['customerId'],
    },
    summarizeArgs: (a) => `تعديل عميل: ${a.name || String(a.customerId).slice(0, 8)}`,
    execute: async (args, ctx) => {
      const customerId = str(args.customerId);
      if (!customerId) return { error: 'customerId مطلوب — استخدم search.customers أولاً' };
      const data: Record<string, unknown> = {};
      if (args.name !== undefined) data.name = str(args.name);
      if (args.phone !== undefined) data.phone = str(args.phone);
      if (args.email !== undefined) data.email = str(args.email);
      if (args.address !== undefined) data.address = str(args.address);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await salesApi.updateCustomer(customerId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل العميل' };
      return { updated: true, customerId, ...data };
    },
  },

  // ─── ─── CRM: Delete Customer ───────────────────────────────────────── ───
  {
    name: 'crm.delete_customer',
    labelAr: 'حذف عميل',
    descriptionAr: 'يحذف عميلاً (نفس sales.delete_customer). استخدم search.customers أولاً.',
    permission: 'crm.delete',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'معرف العميل (UUID)' },
      },
      required: ['customerId'],
    },
    summarizeArgs: (a) => `حذف عميل: ${String(a.customerId).slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const customerId = str(args.customerId);
      if (!customerId) return { error: 'customerId مطلوب — استخدم search.customers أولاً' };
      const res = await salesApi.deleteCustomer(customerId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف العميل (قد يكون له فواتير مرتبطة)' };
      return { deleted: true, customerId };
    },
  },
];
