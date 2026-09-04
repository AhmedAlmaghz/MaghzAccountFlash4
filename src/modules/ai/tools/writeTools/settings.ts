import type { ToolDefinition } from '../../types';
import { hrApi } from '@/modules/hr/api';
import { coreApi } from '@/modules/core/api';
import {
  getDocumentSequences,
  updateDocumentSequence,
  createProductType,
  updateProductType,
  deleteProductType,
  createUnit,
  updateUnit,
  deleteUnit,
  createCashBox,
  updateCashBox,
  deleteCashBox,
  createCostCenter,
  updateCostCenter,
  deleteCostCenter,
  updateDefaultAccount,
  applyDefaultTemplate,
} from '@/core/api';
import {
  num,
  str,
} from './shared';

/**
 * WRITE tools — الإعدادات (21 أداة).
 * Split from the former monolithic writeTools.ts (Phase 77): identical
 * behaviour, smaller merge-conflict surface. Shared helpers in ./shared;
 * every tool stays behind its confirmation-card gate (dangerLevel:
 * 'write') with central audit logging in the tool executor.
 */
export const settingsWriteTools: ToolDefinition[] = [
  // ─── ─── Settings: Update Company ─────────────────────────────────────── ───
  {
    name: 'settings.update_company',
    labelAr: 'تعديل بيانات الشركة',
    descriptionAr: 'يُحدّث معلومات الشركة — الاسم، الرقم الضريبي، العنوان، الهاتف، البريد الإلكتروني.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'اسم الشركة' },
        taxId: { type: 'string', description: 'الرقم الضريبي' },
        address: { type: 'string', description: 'العنوان' },
        phone: { type: 'string', description: 'رقم الهاتف' },
        email: { type: 'string', description: 'البريد الإلكتروني' },
      },
    },
    summarizeArgs: (a) => `تعديل بيانات الشركة: ${String((a as Record<string, unknown>).name || '').slice(0, 30)}`,
    execute: async (args) => {
      const data: Record<string, unknown> = {};
      if (args.name !== undefined) data.name = str(args.name);
      if (args.taxId !== undefined) data.taxId = str(args.taxId);
      if (args.address !== undefined) data.address = str(args.address);
      if (args.phone !== undefined) data.phone = str(args.phone);
      if (args.email !== undefined) data.email = str(args.email);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await coreApi.updateCompany(data);
      if (!res.success) return { error: res.error || 'فشل تعديل بيانات الشركة' };
      return { updated: true, ...data };
    },
  },

  // ─── ─── Settings: Update Branch ──────────────────────────────────────── ───
  {
    name: 'settings.update_branch',
    labelAr: 'تعديل فرع',
    descriptionAr: 'يُحدّث بيانات فرع — الاسم، العنوان، الهاتف، حالة التفعيل. استخدم settings.get_branches أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        branchId: { type: 'string', description: 'معرف الفرع (من settings.get_branches)' },
        name: { type: 'string', description: 'الاسم الجديد' },
        address: { type: 'string', description: 'العنوان الجديد' },
        phone: { type: 'string', description: 'رقم الهاتف الجديد' },
        isActive: { type: 'boolean', description: 'حالة التفعيل' },
      },
      required: ['branchId'],
    },
    summarizeArgs: (a) => `تعديل فرع: ${String((a as Record<string, unknown>).branchId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const branchId = str(args.branchId);
      if (!branchId) return { error: 'branchId مطلوب' };
      const data: Record<string, unknown> = {};
      if (args.name !== undefined) data.name = str(args.name);
      if (args.address !== undefined) data.address = str(args.address);
      if (args.phone !== undefined) data.phone = str(args.phone);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await coreApi.updateBranch(branchId, ctx.companyId, data);
      if (!res.success) return { error: res.error || 'فشل تعديل الفرع' };
      return { updated: true, branchId };
    },
  },

  // ─── ─── Settings: Get Document Sequences ──────────────────────────────── ───
  {
    name: 'settings.get_document_sequences',
    labelAr: 'عرض تسلسلات المستندات',
    descriptionAr: 'يعرض قائمة تسلسلات المستندات (فواتير، أوامر، سندات) مع الأرقام الحالية والبادئات.',
    permission: 'settings.view',
    dangerLevel: 'read',
    parameters: {
      type: 'object',
      properties: {},
    },
    summarizeArgs: () => 'عرض تسلسلات المستندات',
    execute: async (_args, ctx) => {
      const res = await getDocumentSequences(ctx.companyId);
      if (!res.success || !res.data) return { error: res.error || 'فشل جلب تسلسلات المستندات' };
      return { sequences: res.data };
    },
  },

  // ─── ─── Settings: Update Document Sequence ────────────────────────────── ───
  {
    name: 'settings.update_document_sequence',
    labelAr: 'تعديل تسلسل مستند',
    descriptionAr: 'يُحدّث تسلسل مستند — البادئة، الرقم الحالي، خطوة الترقيم، التفعيل. استخدم settings.get_document_sequences أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        sequenceId: { type: 'string', description: 'معرف التسلسل (UUID)' },
        prefix: { type: 'string', description: 'البادئة الجديدة (مثل INV-)' },
        currentNumber: { type: 'number', description: 'الرقم الحالي' },
        incrementStep: { type: 'number', description: 'خطوة الترقيم' },
        isActive: { type: 'boolean', description: 'تفعيل التسلسل' },
      },
      required: ['sequenceId'],
    },
    summarizeArgs: (a) => `تعديل تسلسل مستند: ${String((a as Record<string, unknown>).sequenceId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const sequenceId = str(args.sequenceId);
      if (!sequenceId) return { error: 'sequenceId مطلوب — استخدم settings.get_document_sequences أولاً' };
      const data: Record<string, unknown> = {};
      if (args.prefix !== undefined) data.prefix = str(args.prefix);
      if (args.currentNumber !== undefined) data.currentNumber = num(args.currentNumber);
      if (args.incrementStep !== undefined) data.incrementStep = num(args.incrementStep);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await updateDocumentSequence(sequenceId, data, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل تعديل تسلسل المستند' };
      return { updated: true, sequenceId };
    },
  },

  // ─── ─── Settings: Create Product Type ─────────────────────────────────── ───
  {
    name: 'settings.create_product_type',
    labelAr: 'إضافة نوع منتج',
    descriptionAr: 'يُضيف نوع منتج جديد — الاسم (عربي/إنجليزي) وحالة التفعيل.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        nameAr: { type: 'string', description: 'اسم النوع بالعربية' },
        nameEn: { type: 'string', description: 'اسم النوع بالإنجليزية' },
        isActive: { type: 'boolean', description: 'حالة التفعيل', default: true },
      },
      required: ['nameAr'],
    },
    summarizeArgs: (a) => `إضافة نوع منتج: ${String((a as Record<string, unknown>).nameAr || '').slice(0, 30)}`,
    execute: async (args, ctx) => {
      const nameAr = str(args.nameAr);
      if (!nameAr) return { error: 'nameAr مطلوب' };
      const data: Record<string, unknown> = { nameAr, companyId: ctx.companyId };
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      data.isActive = args.isActive !== undefined ? Boolean(args.isActive) : true;
      const res = await createProductType(data as Parameters<typeof createProductType>[0]);
      if (!res.success) return { error: res.error || 'فشل إضافة نوع المنتج' };
      return { created: true, id: res.id };
    },
  },

  // ─── ─── Settings: Update Product Type ─────────────────────────────────── ───
  {
    name: 'settings.update_product_type',
    labelAr: 'تعديل نوع منتج',
    descriptionAr: 'يُحدّث نوع منتج — الاسم (عربي/إنجليزي)، حالة التفعيل. استخدم settings.get_product_types أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        productTypeId: { type: 'string', description: 'معرف نوع المنتج (UUID)' },
        nameAr: { type: 'string', description: 'الاسم بالعربية' },
        nameEn: { type: 'string', description: 'الاسم بالإنجليزية' },
        isActive: { type: 'boolean', description: 'حالة التفعيل' },
      },
      required: ['productTypeId'],
    },
    summarizeArgs: (a) => `تعديل نوع منتج: ${String((a as Record<string, unknown>).productTypeId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const productTypeId = str(args.productTypeId);
      if (!productTypeId) return { error: 'productTypeId مطلوب — استخدم settings.get_product_types أولاً' };
      const data: Record<string, unknown> = {};
      if (args.nameAr !== undefined) data.nameAr = str(args.nameAr);
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await updateProductType(productTypeId, data, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل تعديل نوع المنتج' };
      return { updated: true, productTypeId };
    },
  },

  // ─── ─── Settings: Delete Product Type ─────────────────────────────────── ───
  {
    name: 'settings.delete_product_type',
    labelAr: 'حذف نوع منتج',
    descriptionAr: 'يحذف نوع منتج. استخدم settings.get_product_types أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        productTypeId: { type: 'string', description: 'معرف نوع المنتج (UUID)' },
      },
      required: ['productTypeId'],
    },
    summarizeArgs: (a) => `حذف نوع منتج: ${a.productTypeId}`,
    execute: async (args, ctx) => {
      const productTypeId = str(args.productTypeId);
      if (!productTypeId) return { error: 'productTypeId مطلوب — استخدم settings.get_product_types أولاً' };
      const res = await deleteProductType(productTypeId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف نوع المنتج' };
      return { deleted: true, productTypeId };
    },
  },

  // ─── ─── Settings: Create Unit ─────────────────────────────────────────── ───
  {
    name: 'settings.create_unit',
    labelAr: 'إضافة وحدة قياس',
    descriptionAr: 'يُضيف وحدة قياس جديدة — الاسم (عربي/إنجليزي)، معامل التحويل، رمز الوحدة، وحدة أساسية.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        nameAr: { type: 'string', description: 'اسم الوحدة بالعربية (مثل: كيلوغرام)' },
        nameEn: { type: 'string', description: 'اسم الوحدة بالإنجليزية (مثل: kg)' },
        code: { type: 'string', description: 'رمز الوحدة (مثل: كجم)' },
        conversionFactor: { type: 'number', description: 'معامل التحويل إلى الوحدة الأساسية' },
        baseUnitId: { type: 'string', description: 'معرف الوحدة الأساسية (UUID)' },
        isActive: { type: 'boolean', description: 'حالة التفعيل', default: true },
      },
      required: ['nameAr'],
    },
    summarizeArgs: (a) => `إضافة وحدة قياس: ${String((a as Record<string, unknown>).nameAr || '').slice(0, 30)}`,
    execute: async (args, ctx) => {
      const nameAr = str(args.nameAr);
      if (!nameAr) return { error: 'nameAr مطلوب' };
      const data: Record<string, unknown> = { nameAr, companyId: ctx.companyId };
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.code !== undefined) data.code = str(args.code);
      if (args.conversionFactor !== undefined) data.conversionFactor = num(args.conversionFactor);
      if (args.baseUnitId !== undefined) data.baseUnitId = str(args.baseUnitId);
      data.isActive = args.isActive !== undefined ? Boolean(args.isActive) : true;
      const res = await createUnit(data as Parameters<typeof createUnit>[0]);
      if (!res.success) return { error: res.error || 'فشل إضافة وحدة القياس' };
      return { created: true, id: res.id };
    },
  },

  // ─── ─── Settings: Update Unit ─────────────────────────────────────────── ───
  {
    name: 'settings.update_unit',
    labelAr: 'تعديل وحدة قياس',
    descriptionAr: 'يُحدّث وحدة قياس — الاسم، الرمز، معامل التحويل، التفعيل. استخدم settings.get_units أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        unitId: { type: 'string', description: 'معرف الوحدة (UUID)' },
        nameAr: { type: 'string', description: 'الاسم بالعربية' },
        nameEn: { type: 'string', description: 'الاسم بالإنجليزية' },
        code: { type: 'string', description: 'رمز الوحدة' },
        conversionFactor: { type: 'number', description: 'معامل التحويل' },
        baseUnitId: { type: 'string', description: 'معرف الوحدة الأساسية' },
        isActive: { type: 'boolean', description: 'حالة التفعيل' },
      },
      required: ['unitId'],
    },
    summarizeArgs: (a) => `تعديل وحدة قياس: ${String((a as Record<string, unknown>).unitId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const unitId = str(args.unitId);
      if (!unitId) return { error: 'unitId مطلوب — استخدم settings.get_units أولاً' };
      const data: Record<string, unknown> = {};
      if (args.nameAr !== undefined) data.nameAr = str(args.nameAr);
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.code !== undefined) data.code = str(args.code);
      if (args.conversionFactor !== undefined) data.conversionFactor = num(args.conversionFactor);
      if (args.baseUnitId !== undefined) data.baseUnitId = str(args.baseUnitId);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await updateUnit(unitId, data, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل تعديل وحدة القياس' };
      return { updated: true, unitId };
    },
  },

  // ─── ─── Settings: Delete Unit ─────────────────────────────────────────── ───
  {
    name: 'settings.delete_unit',
    labelAr: 'حذف وحدة قياس',
    descriptionAr: 'يحذف وحدة قياس. استخدم settings.get_units أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        unitId: { type: 'string', description: 'معرف الوحدة (UUID)' },
      },
      required: ['unitId'],
    },
    summarizeArgs: (a) => `حذف وحدة قياس: ${a.unitId}`,
    execute: async (args, ctx) => {
      const unitId = str(args.unitId);
      if (!unitId) return { error: 'unitId مطلوب — استخدم settings.get_units أولاً' };
      const res = await deleteUnit(unitId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف وحدة القياس' };
      return { deleted: true, unitId };
    },
  },

  // ─── ─── Settings: Create Cash Box ─────────────────────────────────────── ───
  {
    name: 'settings.create_cash_box',
    labelAr: 'إضافة صندوق نقدي',
    descriptionAr: 'يُضيف صندوق نقدي جديد — الاسم (عربي/إنجليزي)، الرصيد الافتتاحي، وصف، حالة التفعيل.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        nameAr: { type: 'string', description: 'اسم الصندوق بالعربية' },
        nameEn: { type: 'string', description: 'اسم الصندوق بالإنجليزية' },
        openingBalance: { type: 'number', description: 'الرصيد الافتتاحي', default: 0 },
        description: { type: 'string', description: 'وصف الصندوق' },
        isActive: { type: 'boolean', description: 'حالة التفعيل', default: true },
      },
      required: ['nameAr'],
    },
    summarizeArgs: (a) => `إضافة صندوق نقدي: ${String((a as Record<string, unknown>).nameAr || '').slice(0, 30)}`,
    execute: async (args, ctx) => {
      const nameAr = str(args.nameAr);
      if (!nameAr) return { error: 'nameAr مطلوب' };
      const data: Record<string, unknown> = { nameAr, companyId: ctx.companyId };
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      data.openingBalance = args.openingBalance !== undefined ? num(args.openingBalance) : 0;
      if (args.description !== undefined) data.description = str(args.description);
      data.isActive = args.isActive !== undefined ? Boolean(args.isActive) : true;
      const res = await createCashBox(data as Parameters<typeof createCashBox>[0]);
      if (!res.success) return { error: res.error || 'فشل إضافة الصندوق النقدي' };
      return { created: true, id: res.id };
    },
  },

  // ─── ─── Settings: Update Cash Box ─────────────────────────────────────── ───
  {
    name: 'settings.update_cash_box',
    labelAr: 'تعديل صندوق نقدي',
    descriptionAr: 'يُحدّث صندوق نقدي — الاسم، الرصيد، الوصف، التفعيل. استخدم settings.get_cash_boxes أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        cashBoxId: { type: 'string', description: 'معرف الصندوق (UUID)' },
        nameAr: { type: 'string', description: 'الاسم بالعربية' },
        nameEn: { type: 'string', description: 'الاسم بالإنجليزية' },
        openingBalance: { type: 'number', description: 'الرصيد الافتتاحي' },
        description: { type: 'string', description: 'الوصف' },
        isActive: { type: 'boolean', description: 'حالة التفعيل' },
      },
      required: ['cashBoxId'],
    },
    summarizeArgs: (a) => `تعديل صندوق نقدي: ${String((a as Record<string, unknown>).cashBoxId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const cashBoxId = str(args.cashBoxId);
      if (!cashBoxId) return { error: 'cashBoxId مطلوب — استخدم settings.get_cash_boxes أولاً' };
      const data: Record<string, unknown> = {};
      if (args.nameAr !== undefined) data.nameAr = str(args.nameAr);
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.openingBalance !== undefined) data.openingBalance = num(args.openingBalance);
      if (args.description !== undefined) data.description = str(args.description);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await updateCashBox(cashBoxId, data, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل تعديل الصندوق النقدي' };
      return { updated: true, cashBoxId };
    },
  },

  // ─── ─── Settings: Delete Cash Box ─────────────────────────────────────── ───
  {
    name: 'settings.delete_cash_box',
    labelAr: 'حذف صندوق نقدي',
    descriptionAr: 'يحذف صندوق نقدي. استخدم settings.get_cash_boxes أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        cashBoxId: { type: 'string', description: 'معرف الصندوق (UUID)' },
      },
      required: ['cashBoxId'],
    },
    summarizeArgs: (a) => `حذف صندوق نقدي: ${a.cashBoxId}`,
    execute: async (args, ctx) => {
      const cashBoxId = str(args.cashBoxId);
      if (!cashBoxId) return { error: 'cashBoxId مطلوب — استخدم settings.get_cash_boxes أولاً' };
      const res = await deleteCashBox(cashBoxId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف الصندوق النقدي' };
      return { deleted: true, cashBoxId };
    },
  },

  // ─── ─── Settings: Create Cost Center ──────────────────────────────────── ───
  {
    name: 'settings.create_cost_center',
    labelAr: 'إضافة مركز تكلفة',
    descriptionAr: 'يُضيف مركز تكلفة جديد — الاسم (عربي/إنجليزي)، الكود، الوصف، مركز تكلفة أب.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        nameAr: { type: 'string', description: 'اسم المركز بالعربية' },
        nameEn: { type: 'string', description: 'اسم المركز بالإنجليزية' },
        code: { type: 'string', description: 'كود المركز' },
        description: { type: 'string', description: 'وصف المركز' },
        parentId: { type: 'string', description: 'معرف المركز الأب (UUID — اختياري)' },
        isActive: { type: 'boolean', description: 'حالة التفعيل', default: true },
      },
      required: ['nameAr'],
    },
    summarizeArgs: (a) => `إضافة مركز تكلفة: ${String((a as Record<string, unknown>).nameAr || '').slice(0, 30)}`,
    execute: async (args, ctx) => {
      const nameAr = str(args.nameAr);
      if (!nameAr) return { error: 'nameAr مطلوب' };
      const data: Record<string, unknown> = { nameAr, companyId: ctx.companyId };
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.code !== undefined) data.code = str(args.code);
      if (args.description !== undefined) data.description = str(args.description);
      if (args.parentId !== undefined) data.parentId = str(args.parentId);
      data.isActive = args.isActive !== undefined ? Boolean(args.isActive) : true;
      const res = await createCostCenter(data as Parameters<typeof createCostCenter>[0]);
      if (!res.success) return { error: res.error || 'فشل إضافة مركز التكلفة' };
      return { created: true, id: res.id };
    },
  },

  // ─── ─── Settings: Update Cost Center ──────────────────────────────────── ───
  {
    name: 'settings.update_cost_center',
    labelAr: 'تعديل مركز تكلفة',
    descriptionAr: 'يُحدّث مركز تكلفة — الاسم، الكود، الوصف، المركز الأب، التفعيل. استخدم settings.get_cost_centers أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        costCenterId: { type: 'string', description: 'معرف المركز (UUID)' },
        nameAr: { type: 'string', description: 'الاسم بالعربية' },
        nameEn: { type: 'string', description: 'الاسم بالإنجليزية' },
        code: { type: 'string', description: 'الكود' },
        description: { type: 'string', description: 'الوصف' },
        parentId: { type: 'string', description: 'معرف المركز الأب' },
        isActive: { type: 'boolean', description: 'حالة التفعيل' },
      },
      required: ['costCenterId'],
    },
    summarizeArgs: (a) => `تعديل مركز تكلفة: ${String((a as Record<string, unknown>).costCenterId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const costCenterId = str(args.costCenterId);
      if (!costCenterId) return { error: 'costCenterId مطلوب — استخدم settings.get_cost_centers أولاً' };
      const data: Record<string, unknown> = {};
      if (args.nameAr !== undefined) data.nameAr = str(args.nameAr);
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.code !== undefined) data.code = str(args.code);
      if (args.description !== undefined) data.description = str(args.description);
      if (args.parentId !== undefined) data.parentId = str(args.parentId);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await updateCostCenter(costCenterId, data, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل تعديل مركز التكلفة' };
      return { updated: true, costCenterId };
    },
  },

  // ─── ─── Settings: Delete Cost Center ──────────────────────────────────── ───
  {
    name: 'settings.delete_cost_center',
    labelAr: 'حذف مركز تكلفة',
    descriptionAr: 'يحذف مركز تكلفة. استخدم settings.get_cost_centers أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        costCenterId: { type: 'string', description: 'معرف المركز (UUID)' },
      },
      required: ['costCenterId'],
    },
    summarizeArgs: (a) => `حذف مركز تكلفة: ${a.costCenterId}`,
    execute: async (args, ctx) => {
      const costCenterId = str(args.costCenterId);
      if (!costCenterId) return { error: 'costCenterId مطلوب — استخدم settings.get_cost_centers أولاً' };
      const res = await deleteCostCenter(costCenterId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل حذف مركز التكلفة' };
      return { deleted: true, costCenterId };
    },
  },

  // ─── ─── Settings: Create Payroll Component ────────────────────────────── ───
  {
    name: 'settings.create_payroll_component',
    labelAr: 'إضافة عنصر راتب',
    descriptionAr: 'يُضيف عنصر راتب جديد — الاسم، النوع (إضافة/خصم)، طريقة الحساب، القيمة.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        nameAr: { type: 'string', description: 'اسم العنصر بالعربية' },
        nameEn: { type: 'string', description: 'اسم العنصر بالإنجليزية' },
        type: { type: 'string', enum: ['allowance', 'deduction'], description: 'النوع: إضافة (allowance) أو خصم (deduction)' },
        calculationMethod: { type: 'string', enum: ['fixed', 'percentage'], description: 'طريقة الحساب: ثابت (fixed) أو نسبة (percentage)' },
        value: { type: 'number', description: 'القيمة (المبلغ الثابت أو النسبة المئوية)' },
        isActive: { type: 'boolean', description: 'حالة التفعيل', default: true },
      },
      required: ['nameAr', 'type'],
    },
    summarizeArgs: (a) => `إضافة عنصر راتب: ${String((a as Record<string, unknown>).nameAr || '').slice(0, 30)}`,
    execute: async (args, ctx) => {
      const nameAr = str(args.nameAr);
      if (!nameAr) return { error: 'nameAr مطلوب' };
      const rawType = str(args.type);
      if (!rawType) return { error: 'type مطلوب — allowance أو deduction' };
      // Map legacy tool vocabulary to the payroll_components enum
      const type = rawType === 'deduction' ? 'deduction' as const : 'earning' as const;
      const res = await hrApi.createPayrollComponent({
        companyId: ctx.companyId,
        nameAr,
        nameEn: str(args.nameEn),
        type,
        calculationMethod: str(args.calculationMethod) as 'fixed' | 'percentage' | undefined,
        defaultAmount: args.value !== undefined ? num(args.value) : 0,
        isActive: args.isActive !== undefined ? Boolean(args.isActive) : true,
      }, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل إضافة عنصر الراتب' };
      return { created: true, id: res.id };
    },
  },

  // ─── ─── Settings: Update Payroll Component ────────────────────────────── ───
  {
    name: 'settings.update_payroll_component',
    labelAr: 'تعديل عنصر راتب',
    descriptionAr: 'يُحدّث عنصر راتب — الاسم، النوع، طريقة الحساب، القيمة، التفعيل. استخدم settings.get_payroll_components أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        componentId: { type: 'string', description: 'معرف العنصر (UUID)' },
        nameAr: { type: 'string', description: 'الاسم بالعربية' },
        nameEn: { type: 'string', description: 'الاسم بالإنجليزية' },
        type: { type: 'string', enum: ['allowance', 'deduction'], description: 'النوع' },
        calculationMethod: { type: 'string', enum: ['fixed', 'percentage'], description: 'طريقة الحساب' },
        value: { type: 'number', description: 'القيمة' },
        isActive: { type: 'boolean', description: 'حالة التفعيل' },
      },
      required: ['componentId'],
    },
    summarizeArgs: (a) => `تعديل عنصر راتب: ${String((a as Record<string, unknown>).componentId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const componentId = str(args.componentId);
      if (!componentId) return { error: 'componentId مطلوب — استخدم settings.get_payroll_components أولاً' };
      const data: Parameters<typeof hrApi.updatePayrollComponent>[2] = {};
      if (args.nameAr !== undefined) data.nameAr = str(args.nameAr);
      if (args.nameEn !== undefined) data.nameEn = str(args.nameEn);
      if (args.type !== undefined) {
        const rawType = str(args.type);
        data.type = rawType === 'deduction' ? 'deduction' : 'earning';
      }
      if (args.calculationMethod !== undefined) data.calculationMethod = str(args.calculationMethod) as 'fixed' | 'percentage' | 'formula';
      if (args.value !== undefined) data.defaultAmount = num(args.value);
      if (args.isActive !== undefined) data.isActive = Boolean(args.isActive);
      if (Object.keys(data).length === 0) return { error: 'يجب تمرير حقل واحد على الأقل للتعديل' };
      const res = await hrApi.updatePayrollComponent(componentId, ctx.companyId, data, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل تعديل عنصر الراتب' };
      return { updated: true, componentId };
    },
  },

  // ─── ─── Settings: Deactivate Payroll Component ────────────────────────── ───
  {
    name: 'settings.deactivate_payroll_component',
    labelAr: 'تعطيل عنصر راتب',
    descriptionAr: 'يعطّل عنصر راتب (بدون حذف — العناصر المرتبطة بمسيرات سابقة تبقى سليمة). لن يستخدمه محرك الرواتب في الحسابات القادمة. استخدم settings.get_payroll_components أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        componentId: { type: 'string', description: 'معرف العنصر (UUID)' },
      },
      required: ['componentId'],
    },
    summarizeArgs: (a) => `تعطيل عنصر راتب: ${String((a as Record<string, unknown>).componentId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const componentId = str(args.componentId);
      if (!componentId) return { error: 'componentId مطلوب — استخدم settings.get_payroll_components أولاً' };
      const res = await hrApi.deactivatePayrollComponent(componentId, ctx.companyId, ctx.userId);
      if (!res.success) return { error: res.error || 'فشل تعطيل عنصر الراتب' };
      return { deactivated: true, componentId, note: 'لن يستخدمه محرك الرواتب في الحسابات القادمة — المسيرات السابقة كما هي' };
    },
  },

  // ─── ─── Settings: Update Default Account ──────────────────────────────── ───
  {
    name: 'settings.update_default_account',
    labelAr: 'تعديل حساب افتراضي',
    descriptionAr: 'يُحدّث الحساب الافتراضي لنوع معين — يربط حساباً أو يفصل الحساب (بإرسال null). استخدم settings.get_default_accounts أولاً.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        defaultAccountId: { type: 'string', description: 'معرف الحساب الافتراضي (UUID من settings.get_default_accounts)' },
        accountId: { type: 'string', description: 'معرف الحساب من شجرة الحسابات (UUID — أرسل null لفصل الحساب)' },
      },
      required: ['defaultAccountId', 'accountId'],
    },
    summarizeArgs: (a) => `تعديل حساب افتراضي: ${String((a as Record<string, unknown>).defaultAccountId || '').slice(0, 8)}…`,
    execute: async (args, ctx) => {
      const defaultAccountId = str(args.defaultAccountId);
      if (!defaultAccountId) return { error: 'defaultAccountId مطلوب — استخدم settings.get_default_accounts أولاً' };
      const accountId = args.accountId && typeof args.accountId === 'string' && args.accountId.trim() ? args.accountId.trim() : null;
      const res = await updateDefaultAccount(defaultAccountId, accountId, ctx.companyId);
      if (!res.success) return { error: res.error || 'فشل تعديل الحساب الافتراضي' };
      return { updated: true, defaultAccountId };
    },
  },

  // ─── ─── Settings: Apply Default Template ────────────────────────────────── ───
  {
    name: 'settings.apply_default_template',
    labelAr: 'تطبيق نموذج حسابات افتراضي',
    descriptionAr: 'يطبق نموذج حسابات افتراضي على الحسابات الافتراضية للنظام. الخيارات: trading (تجاري)، manufacturing (تصنيعي)، services (خدمي). يحذّر: هذا يستبدل الحسابات الافتراضية الحالية.',
    permission: 'settings.edit',
    dangerLevel: 'write',
    parameters: {
      type: 'object',
      properties: {
        template: {
          type: 'string',
          enum: ['trading', 'manufacturing', 'services'],
          description: 'نموذج الحسابات: trading (تجاري)، manufacturing (تصنيعي)، services (خدمي)',
        },
      },
      required: ['template'],
    },
    summarizeArgs: (a) => `تطبيق نموذج ${(a as Record<string, unknown>).template}`,
    execute: async (args, ctx) => {
      const template = str(args.template);
      if (!template || !['trading', 'manufacturing', 'services'].includes(template)) {
        return { error: 'template يجب أن يكون واحداً من: trading، manufacturing، services' };
      }
      const res = await applyDefaultTemplate(ctx.companyId, template as 'trading' | 'manufacturing' | 'services');
      if (!res.success) return { error: res.error || 'فشل تطبيق نموذج الحسابات' };
      return { applied: true, template };
    },
  },
];
