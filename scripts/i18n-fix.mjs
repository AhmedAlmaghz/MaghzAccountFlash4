// إصلاح شامل للمفاتيح الناقصة في ملفات الترجمة ar.json / en.json
import { readFileSync, writeFileSync } from 'node:fs';

const V = {
  'accounting.cashBox': ['صندوق النقد', 'Cash Box'],
  'accounting.chartOfAccountsSubtitle': ['إدارة شجرة الحسابات والتصنيفات', 'Manage chart of accounts and classifications'],
  'accounting.journalEntriesSubtitle': ['إدارة وعرض القيود المحاسبية اليومية', 'Manage and view daily journal entries'],
  'accounting.ledgerSubtitle': ['عرض حركات حساب معين', 'View transactions of a specific account'],
  'accounting.post': ['ترحيل', 'Post'],
  'accounting.voucherNumberError': ['رقم السند غير صالح', 'Invalid voucher number'],
  'all': ['الكل', 'All'],
  'auth.users.created': ['تم إنشاء المستخدم', 'User created'],
  'auth.users.deleted': ['تم حذف المستخدم', 'User deleted'],
  'auth.users.updated': ['تم تحديث المستخدم', 'User updated'],
  'balance': ['الرصيد', 'Balance'],
  'common.createdBy': ['أنشئ بواسطة', 'Created by'],
  'common.invalidAmount': ['مبلغ غير صالح', 'Invalid amount'],
  'common.search': ['بحث', 'Search'],
  'date': ['التاريخ', 'Date'],
  'description': ['الوصف', 'Description'],
  'documentNumber': ['رقم المستند', 'Document Number'],
  'filter.allDocs': ['كل المستندات', 'All documents'],
  'filter.myDocsOnly': ['مستنداتي فقط', 'My documents only'],
  'filter.showAll': ['عرض الكل', 'Show all'],
  'header.collapseSidebar': ['طي الشريط الجانبي', 'Collapse sidebar'],
  'inventory.empty.warehouseProducts.description': ['لا توجد منتجات في هذا المستودع', 'No products in this warehouse'],
  'inventory.products.notFound': ['لم يتم العثور على منتجات مطابقة', 'No matching products found'],
  'manufacturing.costs.amount': ['المبلغ', 'Amount'],
  'manufacturing.costs.description': ['الوصف', 'Description'],
  'manufacturing.costs.descriptionPlaceholder': ['وصف بند التكلفة...', 'Cost item description...'],
  'manufacturing.costs.energy': ['الطاقة', 'Energy'],
  'manufacturing.costs.labor': ['العمالة', 'Labor'],
  'manufacturing.costs.other': ['أخرى', 'Other'],
  'manufacturing.costs.packaging': ['التغليف', 'Packaging'],
  'manufacturing.costs.total': ['الإجمالي', 'Total'],
  'manufacturing.workOrders.actualDatesTitle': ['التواريخ الفعلية', 'Actual Dates'],
  'manufacturing.workOrders.actualProducedQuantity': ['الكمية المنتجة الفعلية', 'Actual Produced Quantity'],
  'manufacturing.workOrders.actualUnitCost': ['تكلفة الوحدة الفعلية', 'Actual Unit Cost'],
  'manufacturing.workOrders.autoTotalCost': ['التكلفة الإجمالية (تلقائي)', 'Total Cost (auto)'],
  'manufacturing.workOrders.autoTotalHint': ['تُحسب تلقائياً من الكمية × تكلفة الوحدة', 'Computed automatically from quantity × unit cost'],
  'manufacturing.workOrders.batchAutoHint': ['عدد الدفعات = الكمية ÷ كمية الناتج في قائمة المواد', 'Batches = quantity ÷ BOM output quantity'],
  'manufacturing.workOrders.batchFormatHint': ['مثال: 2.5', 'e.g. 2.5'],
  'manufacturing.workOrders.batchesHint': ['يمكن استخدام كسور عشرية للدفعات', 'Decimal batch counts are allowed'],
  'manufacturing.workOrders.changeStatus': ['تغيير الحالة', 'Change Status'],
  'manufacturing.workOrders.changeStatusTo': ['تغيير الحالة إلى', 'Change status to'],
  'manufacturing.workOrders.costBreakdown': ['تفصيل التكاليف', 'Cost Breakdown'],
  'manufacturing.workOrders.deleteMessage': ['سيتم حذف أمر التشغيل نهائياً', 'Work order will be permanently deleted'],
  'manufacturing.workOrders.deleteTitle': ['حذف أمر التشغيل', 'Delete Work Order'],
  'manufacturing.workOrders.details': ['تفاصيل أمر التشغيل', 'Work Order Details'],
  'manufacturing.workOrders.editWorkOrder': ['تعديل أمر التشغيل', 'Edit Work Order'],
  'manufacturing.workOrders.emptyDescription': ['ابدأ بإنشاء أمر تشغيل من قائمة المواد', 'Create a work order from a BOM'],
  'manufacturing.workOrders.emptyTitle': ['لا توجد أوامر تشغيل', 'No Work Orders'],
  'manufacturing.workOrders.enterActualQuantity': ['أدخل الكمية المنتجة الفعلية', 'Enter actual produced quantity'],
  'manufacturing.workOrders.expectedProduction': ['الإنتاج المتوقع', 'Expected Production'],
  'manufacturing.workOrders.filterByStatus': ['تصفية حسب الحالة', 'Filter by status'],
  'manufacturing.workOrders.invalidDates': ['تواريخ غير صالحة', 'Invalid dates'],
  'manufacturing.workOrders.materialsCost': ['تكلفة المواد', 'Materials Cost'],
  'manufacturing.workOrders.negativeValuesError': ['لا يُسمح بالقيم السالبة', 'Negative values are not allowed'],
  'manufacturing.workOrders.newWorkOrder': ['أمر تشغيل جديد', 'New Work Order'],
  'manufacturing.workOrders.noBom': ['بدون قائمة مواد', 'No BOM'],
  'manufacturing.workOrders.orderNumber': ['رقم الأمر', 'Order Number'],
  'manufacturing.workOrders.plannedDatesTitle': ['التواريخ المخططة', 'Planned Dates'],
  'manufacturing.workOrders.plannedEndDate': ['تاريخ الانتهاء المخطط', 'Planned End Date'],
  'manufacturing.workOrders.plannedMaterials': ['المواد المخططة', 'Planned Materials'],
  'manufacturing.workOrders.plannedQuantity': ['الكمية المخططة', 'Planned Quantity'],
  'manufacturing.workOrders.plannedStartDate': ['تاريخ البدء المخطط', 'Planned Start Date'],
  'manufacturing.workOrders.producedDefaultHint': ['تُملأ تلقائياً بالكمية المخططة', 'Defaults to planned quantity'],
  'manufacturing.workOrders.productionCosts': ['تكاليف الإنتاج', 'Production Costs'],
  'manufacturing.workOrders.productionCostsHint': ['أضف بنود التكاليف الإضافية (عمالة، طاقة...)', 'Add extra cost items (labor, energy...)'],
  'manufacturing.workOrders.productionCostsTotal': ['إجمالي تكاليف الإنتاج', 'Total Production Costs'],
  'manufacturing.workOrders.recordActual': ['تسجيل الفعلي', 'Record Actuals'],
  'manufacturing.workOrders.requiredFields': ['الحقول الإلزامية مفقودة', 'Missing required fields'],
  'manufacturing.workOrders.saveActual': ['حفظ الفعلي', 'Save Actuals'],
  'manufacturing.workOrders.selectSupervisor': ['اختر المشرف', 'Select supervisor'],
  'manufacturing.workOrders.statusUpdated': ['تم تحديث الحالة', 'Status updated'],
  'manufacturing.workOrders.subtitle': ['جدولة وتنفيذ أوامر الإنتاج', 'Schedule and execute production orders'],
  'manufacturing.workOrders.supervisor': ['المشرف', 'Supervisor'],
  'manufacturing.workOrders.title': ['أوامر التشغيل', 'Work Orders'],
  'manufacturing.workOrders.totalCost': ['التكلفة الإجمالية', 'Total Cost'],
  'manufacturing.workOrders.totalCount': ['إجمالي الأوامر', 'Total Orders'],
  'manufacturing.workOrders.unitCost': ['تكلفة الوحدة', 'Unit Cost'],
  'manufacturing.workOrders.varianceReport': ['تحليل الفروقات', 'Variance Report'],
  'manufacturing.workOrders.withoutBom': ['بدون BOM', 'Without BOM'],
  'notes': ['ملاحظات', 'Notes'],
  'pos.insufficientCash': ['رصيد الصندوق غير كافٍ', 'Insufficient cash in drawer'],
  'reports.asc': ['تصاعدي', 'Ascending'],
  'reports.desc': ['تنازلي', 'Descending'],
  'reports.filterAll': ['الكل', 'All'],
  'reports.rows': ['الصفوف', 'Rows'],
  'reports.sortBy': ['الترتيب حسب', 'Sort by'],
  'reports.sortDir': ['اتجاه الترتيب', 'Sort direction'],
  'sales.invoice.baseTotal': ['الإجمالي بالعملة الأساسية', 'Total in base currency'],
  'sales.invoice.emptyDescription': ['أنشئ فاتورتك الأولى', 'Create your first invoice'],
  'sales.invoice.emptyLines': ['أضف سطراً واحداً على الأقل', 'Add at least one line'],
  'sales.invoice.linesDesc': ['أسطر الفاتورة بالعملة المحددة', 'Invoice lines in the selected currency'],
  'sales.invoice.notesHint': ['ملاحظات تظهر في الفاتورة', 'Notes shown on the invoice'],
  'sales.invoice.numberError': ['رقم الفاتورة غير صالح', 'Invalid invoice number'],
  'sales.invoice.summary': ['ملخص الفاتورة', 'Invoice Summary'],
  'sales.notesPlaceholder': ['ملاحظات إضافية...', 'Additional notes...'],
  'sales.quotation.numberError': ['رقم عرض السعر غير صالح', 'Invalid quotation number'],
  'sales.return.numberError': ['رقم المرتجع غير صالح', 'Invalid return number'],
  'sales.status.sent': ['مُرسل', 'Sent'],
  'settings.branches.deleteError': ['خطأ في حذف الفرع', 'Error deleting branch'],
  'settings.branches.nameRequired': ['اسم الفرع مطلوب', 'Branch name is required'],
  'settings.calendar': ['التقويم', 'Calendar'],
  'settings.calendar.gregorian': ['ميلادي', 'Gregorian'],
  'settings.calendar.hijri': ['هجري', 'Hijri'],
  'settings.cashBoxes.createError': ['خطأ في إنشاء صندوق النقد', 'Error creating cash box'],
  'settings.cashBoxes.deleteError': ['خطأ في حذف صندوق النقد', 'Error deleting cash box'],
  'settings.cashBoxes.nameRequired': ['اسم الصندوق مطلوب', 'Cash box name is required'],
  'settings.cashBoxes.updateError': ['خطأ في تحديث صندوق النقد', 'Error updating cash box'],
  'settings.common.notes': ['ملاحظات', 'Notes'],
  'settings.common.saving': ['جارٍ الحفظ...', 'Saving...'],
  'settings.costCenters.createError': ['خطأ في إنشاء مركز التكلفة', 'Error creating cost center'],
  'settings.costCenters.deleteMessage': ['سيتم حذف مركز التكلفة نهائياً', 'Cost center will be permanently deleted'],
  'settings.costCenters.deleteTitle': ['حذف مركز التكلفة', 'Delete Cost Center'],
  'settings.costCenters.deleted': ['تم حذف مركز التكلفة', 'Cost center deleted'],
  'settings.costCenters.nameRequired': ['اسم المركز مطلوب', 'Center name is required'],
  'settings.costCenters.removeError': ['خطأ في حذف مركز التكلفة', 'Error removing cost center'],
  'settings.costCenters.updateError': ['خطأ في تحديث مركز التكلفة', 'Error updating cost center'],
  'settings.currencies.codeAndNameRequired': ['الكود والاسم مطلوبان', 'Code and name are required'],
  'settings.currencies.codeLength': ['الكود يجب أن يكون 3 أحرف', 'Code must be 3 characters'],
  'settings.currencies.deleteError': ['خطأ في حذف العملة', 'Error deleting currency'],
  'settings.currencies.saveError': ['خطأ في حفظ العملة', 'Error saving currency'],
  'settings.currencies.setDefaultSuccess': ['تم تعيين العملة الافتراضية', 'Default currency set'],
  'settings.decimalPlaces': ['المنازل العشرية', 'Decimal Places'],
  'settings.defaultAccounts.applied': ['تم تطبيق الحسابات الافتراضية', 'Default accounts applied'],
  'settings.defaultAccounts.applyError': ['خطأ في تطبيق الحسابات الافتراضية', 'Error applying default accounts'],
  'settings.defaultAccounts.updateError': ['خطأ في تحديث الحساب', 'Error updating account'],
  'settings.productCategories.createError': ['خطأ في إنشاء التصنيف', 'Error creating category'],
  'settings.productCategories.deleteError': ['خطأ في حذف التصنيف', 'Error deleting category'],
  'settings.productCategories.nameRequired': ['اسم التصنيف مطلوب', 'Category name is required'],
  'settings.productCategories.updateError': ['خطأ في تحديث التصنيف', 'Error updating category'],
  'settings.productTypes.createError': ['خطأ في إنشاء النوع', 'Error creating type'],
  'settings.productTypes.deleteError': ['خطأ في حذف النوع', 'Error deleting type'],
  'settings.productTypes.nameRequired': ['اسم النوع مطلوب', 'Type name is required'],
  'settings.productTypes.updateError': ['خطأ في تحديث النوع', 'Error updating type'],
  'settings.sequences.previewError': ['خطأ في المعاينة', 'Preview error'],
  'settings.sequences.updateError': ['خطأ في تحديث التسلسل', 'Error updating sequence'],
  'settings.units.deleteMessage': ['سيتم حذف الوحدة نهائياً', 'Unit will be permanently deleted'],
  'settings.units.deleteTitle': ['حذف الوحدة', 'Delete Unit'],
  'settings.units.nameRequired': ['اسم الوحدة مطلوب', 'Unit name is required'],
  'settings.users.cannotDeleteSelf': ['لا يمكنك حذف حسابك الخاص', 'You cannot delete your own account'],
  'settings.users.deleteError': ['خطأ في حذف المستخدم', 'Error deleting user'],
  'settings.users.passwordInsecure': ['كلمة المرور ضعيفة', 'Password is weak'],
  'settings.users.passwordRequired': ['كلمة المرور مطلوبة', 'Password is required'],
  'settings.users.passwordReset': ['تم إعادة تعيين كلمة المرور', 'Password has been reset'],
  'settings.users.passwordTooShort': ['كلمة المرور قصيرة جداً', 'Password is too short'],
  'settings.users.passwordWeak': ['كلمة المرور ضعيفة — أضف أحرفاً وأرقاماً', 'Weak password — add letters and numbers'],
  'settings.users.saveError': ['خطأ في حفظ المستخدم', 'Error saving user'],
  'settings.users.usernameRequired': ['اسم المستخدم مطلوب', 'Username is required'],
  'settings.vat.account': ['الحساب', 'Account'],
  'settings.vat.deleteError': ['خطأ في حذف الضريبة', 'Error deleting VAT rate'],
  'settings.vat.deleted': ['تم حذف الضريبة', 'VAT rate deleted'],
  'settings.vat.disabled': ['تم تعطيل الضريبة', 'VAT rate disabled'],
  'settings.vat.nameRequired': ['اسم الضريبة مطلوب', 'VAT name is required'],
  'settings.vat.rateInvalid': ['النسبة غير صالحة', 'Invalid rate'],
  'settings.vat.saveError': ['خطأ في حفظ الضريبة', 'Error saving VAT rate'],
  'sidebar.reports.title': ['التقارير', 'Reports'],
  'validation.required': ['هذا الحقل مطلوب', 'This field is required'],
};

function setNested(obj, path, val) {
  const parts = path.split('.');
  let d = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof d[parts[i]] !== 'object' || d[parts[i]] === null) d[parts[i]] = {};
    d = d[parts[i]];
  }
  d[parts[parts.length - 1]] = val;
}

for (const [i, lang] of ['ar', 'en'].entries()) {
  const p = 'src/core/i18n/' + lang + '.json';
  const d = JSON.parse(readFileSync(p, 'utf8'));
  let added = 0;
  for (const [key, [arV, enV]] of Object.entries(V)) {
    let dd = d, ok = true;
    for (const part of key.split('.')) {
      if (dd && typeof dd === 'object' && part in dd) dd = dd[part]; else { ok = false; break; }
    }
    if (!ok || typeof dd !== 'string') { setNested(d, key, lang === 'ar' ? arV : enV); added++; }
  }
  writeFileSync(p, JSON.stringify(d, null, 2) + '\n', 'utf8');
  // تحقق فوري
  const check = JSON.parse(readFileSync(p, 'utf8'));
  let missing = 0;
  for (const key of Object.keys(V)) {
    let dd = check;
    for (const part of key.split('.')) {
      if (dd && typeof dd === 'object' && part in dd) dd = dd[part]; else { missing++; console.log(lang, 'STILL MISSING:', key); break; }
    }
  }
  console.log(lang + ': added ' + added + ', missing after write: ' + missing);
}
