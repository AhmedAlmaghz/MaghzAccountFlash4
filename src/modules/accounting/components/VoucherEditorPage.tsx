import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, Send, Printer, FileSpreadsheet, FileDown } from 'lucide-react';
import { Card, Button, Input } from '@/core/ui/components';
import { DocumentPageShell, TotalsPanel, useDocumentEditorGuard, useRestoreDraft, UnsavedChangesDialog } from '@/core/ui/components/document';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { CustomerSelect, SupplierSelect, CashBoxSelect, AccountSelect } from '@/core/ui/components/smart';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useFormatters } from '@/core/utils/useFormatters';
import { useDocumentExport, type EditorDocumentData } from '@/core/utils/useDocumentExport';
import { useSettings } from '@/core/utils/useSettings';
import { useDefaultPaymentAccounts } from '@/core/hooks/useDefaultPaymentAccounts';
import { toDateString } from '@/core/utils/mapPgRow';
import { getNextDocumentNumber } from '@/core/api';
import { accountingApi } from '../api';

type VoucherType = 'receipt' | 'payment';
type PaymentMethod = 'cash' | 'bank' | 'check';

/** Local calendar day — `toISOString()` gives YESTERDAY for GMT+3 between 00:00–03:00. */
const localToday = (): string => toDateString(new Date()) ?? '';

/**
 * Receipt / payment voucher editor.
 *
 * The API's create* schemas require `companyId`, `voucherNumber` and
 * `paymentMethod`; `createPaymentVoucher` additionally requires a supplier
 * OR an expense account. The previous modal offered BOTH — restoring them
 * here fixes the "required field" error for general expenses (rent,
 * internet, …) that have no supplier.
 */
export const VoucherEditorPage: React.FC<{ type: VoucherType }> = ({ type }) => {
  const { t } = useTranslation();
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((s) => s.activeCompany);
  const user = useAuthStore((s) => s.user);
  const companyId = activeCompany?.id || '';
  const { formatCurrency } = useFormatters(companyId);
  // تلقائي: اختيار الصندوق الافتراضي للشركة عندما لا يُختار خزنة أخرى — يمنع
  // "قيد مرفوض/مطلوب" للمصروفات الناتجة عن "محذوف الصندوق" (اختيارك: متى نملأ؟ الآن: فوراً).
  const { defaultCashBoxId } = useDefaultPaymentAccounts(companyId);

  const isEdit = Boolean(id);
  const isReceipt = type === 'receipt';
  const backPath = isReceipt ? '/accounting/receipt-vouchers' : '/accounting/payment-vouchers';

  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [expenseAccountId, setExpenseAccountId] = useState('');
  const [expenseAccountName, setExpenseAccountName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [date, setDate] = useState(localToday());
  const [amount, setAmount] = useState('');
  const [cashBoxId, setCashBoxId] = useState('');
  const [checkNumber, setCheckNumber] = useState('');
  const [checkDate, setCheckDate] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const { settings } = useSettings(companyId);
  const showReference = settings?.showReference ?? true;
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const [status, setStatus] = useState<string>('draft');

  const draft = useMemo(
    () => ({ partyId, partyName, expenseAccountId, paymentMethod, date, amount, cashBoxId, checkNumber, checkDate, reference, notes, docNumber }),
    [partyId, partyName, expenseAccountId, paymentMethod, date, amount, cashBoxId, checkNumber, checkDate, reference, notes, docNumber],
  );
  const { blocked, proceed, reset, guardNavigate, clearDraft, isDirty } = useDocumentEditorGuard(
    isReceipt ? 'receipt-voucher' : 'payment-voucher', draft, loading, isEdit, saving,
  );
  const draftSetters = useMemo(() => ({
    partyId: setPartyId, partyName: setPartyName, expenseAccountId: setExpenseAccountId,
    paymentMethod: setPaymentMethod, date: setDate, amount: setAmount, cashBoxId: setCashBoxId,
    checkNumber: setCheckNumber, checkDate: setCheckDate, reference: setReference, notes: setNotes, docNumber: setDocNumber,
  }), []);
  useRestoreDraft(isReceipt ? 'receipt-voucher' : 'payment-voucher', isEdit, draftSetters);

  // Reserve a number for a NEW voucher (create* schemas require it and the
  // API never generates one). Keep the loaded number when editing.
  useEffect(() => {
    if (isEdit || !companyId) return;
    let cancelled = false;
    (async () => {
      const seq = await getNextDocumentNumber(companyId, isReceipt ? 'receipt_voucher' : 'payment_voucher');
      if (!cancelled && seq.success && seq.number) setDocNumber(seq.number);
    })();
    return () => { cancelled = true; };
  }, [isEdit, companyId, isReceipt]);

  // اختيار الصندوق الافتراضي تلقائياً عندما لا يوجد خيار مُختار (ولو قبل وصول الافتراضي).
  useEffect(() => {
    if (cashBoxId) return;
    if (defaultCashBoxId) setCashBoxId(defaultCashBoxId);
  }, [cashBoxId, defaultCashBoxId]);

  useEffect(() => {
    let cancelled = false;
    if (!id || !companyId) return;
    setLoading(true);
    (async () => {
      const res = isReceipt
        ? await accountingApi.getReceiptVoucherById(companyId, id)
        : await accountingApi.getPaymentVoucherById(companyId, id);
      const row = res?.data;
      if (cancelled) return;
      setLoading(false);
      if (row) {
        const v = row as {
          customerId?: string; supplierId?: string; expenseAccountId?: string; voucherNumber?: string;
          date?: string; amount?: number; cashBoxId?: string; paymentMethod?: string;
          checkNumber?: string; checkDate?: string; reference?: string; notes?: string; status?: string;
        };
        setPartyId((v.customerId ?? v.supplierId) || '');
        setExpenseAccountId(v.expenseAccountId || '');
        setDocNumber(v.voucherNumber || '');
        setDate(v.date ? toDateString(v.date) ?? '' : localToday());
        setAmount(String(v.amount ?? ''));
        setCashBoxId(v.cashBoxId ?? '');
        setPaymentMethod((v.paymentMethod as PaymentMethod) || 'cash');
        setCheckNumber(v.checkNumber ?? '');
        setCheckDate(v.checkDate ? toDateString(v.checkDate) ?? '' : '');
        setReference(v.reference ?? '');
        setNotes(v.notes ?? '');
        setStatus(v.status ?? 'draft');
      }
    })();
    return () => { cancelled = true; };
  }, [id, companyId, isReceipt]);

  const amt = Number(amount) || 0;

  /** Validate with a SPECIFIC message — a generic "مطلوب" leaves the user guessing. */
  const validate = useCallback((): string | null => {
    if (!companyId) return t('errors.db.notNullViolation', { default: 'حقل إلزامي مفقود' });
    if (isReceipt && !partyId) return t('accounting.selectCustomer');
    if (!isReceipt && !partyId && !expenseAccountId) return t('accounting.selectSupplierOrExpense');
    if (!(amt > 0)) return t('accounting.enterAmount');
    if (paymentMethod === 'check' && !checkNumber.trim()) return t('accounting.checkNumberRequired', { default: t('accounting.checkNumber') });
    return null;
  }, [companyId, isReceipt, partyId, expenseAccountId, amt, paymentMethod, checkNumber, t]);

  const save = useCallback(async (post?: boolean) => {
    const problem = validate();
    if (problem) {
      addToast('error', problem);
      return;
    }
    setSaving(true);
    let voucherNumber = docNumber;
    if (!isEdit || !id) {
      const seq = await getNextDocumentNumber(companyId, isReceipt ? 'receipt_voucher' : 'payment_voucher');
      if (!seq.success || !seq.number) {
        setSaving(false);
        addToast('error', seq.error || t('accounting.voucherNumberError'));
        return;
      }
      voucherNumber = seq.number;
      setDocNumber(voucherNumber);
    }
    const shared = {
      companyId,
      voucherNumber,
      date,
      amount: amt,
      cashBoxId: cashBoxId || undefined,
      paymentMethod,
      checkNumber: paymentMethod === 'check' ? checkNumber || undefined : undefined,
      checkDate: paymentMethod === 'check' && checkDate ? checkDate : undefined,
      reference: reference || undefined,
      notes: notes || undefined,
      status: post ? 'posted' : 'draft',
    };
    const payload = isReceipt
      ? { ...shared, customerId: partyId || undefined }
      : { ...shared, supplierId: partyId || undefined, expenseAccountId: expenseAccountId || undefined };
    const result = isReceipt
      ? isEdit && id
        ? await accountingApi.updateReceiptVoucher(id, companyId, user?.id ?? '', payload as never)
        : await accountingApi.createReceiptVoucher(payload as never, user?.id ?? '')
      : isEdit && id
        ? await accountingApi.updatePaymentVoucher(id, companyId, user?.id ?? '', payload as never)
        : await accountingApi.createPaymentVoucher(payload as never, user?.id ?? '');
    setSaving(false);
    if (result?.success) {
      clearDraft();
      addToast('success', t('common.saved'));
      navigate(backPath);
    } else {
      addToast('error', result?.error || t('common.error'));
    }
  }, [validate, addToast, isEdit, id, companyId, isReceipt, docNumber, date, amt, cashBoxId, paymentMethod, checkNumber, checkDate, reference, notes, partyId, expenseAccountId, user?.id, t, navigate, backPath, clearDraft]);

  const exportData: EditorDocumentData = useMemo(() => ({
    type: isReceipt ? 'receipt-voucher' : 'payment-voucher',
    docNumber: docNumber || (isReceipt ? t('accounting.newReceiptVoucher') : t('accounting.newPaymentVoucher')),
    date,
    partyName: isReceipt
      ? (partyName || t('accounting.customer'))
      : (partyName || (expenseAccountName ? expenseAccountName : t('accounting.supplier'))),
    partyLabel: isReceipt ? t('accounting.customer') : t('accounting.supplier'),
    lines: [{
      productName: notes || (isReceipt ? t('accounting.receiptVouchers') : t('accounting.paymentVouchers')),
      quantity: 1,
      unitPrice: amt,
      lineTotal: amt,
    }],
    subtotal: amt,
    discountAmount: 0,
    vatAmount: 0,
    totalAmount: amt,
    notes,
    currency: activeCompany?.currency,
    paymentType: paymentMethod,
    company: activeCompany ? {
      name: activeCompany.name, taxNumber: activeCompany.taxNumber, address: activeCompany.address,
      phone: activeCompany.phone, email: activeCompany.email, logoUrl: activeCompany.logoUrl,
    } : undefined,
  }), [isReceipt, docNumber, t, date, partyName, expenseAccountName, notes, amt, paymentMethod, activeCompany]);

  const { onPrint, onExcel, onPdf } = useDocumentExport(exportData, t);

  const title = isEdit
    ? t('accounting.editVoucher')
    : (isReceipt ? t('accounting.newReceiptVoucher') : t('accounting.newPaymentVoucher'));
  const actions = (
    <>
      {isEdit && (
        <>
          <Button variant="ghost" size="sm" onClick={onPrint} title={t('print.title')} aria-label={t('print.title')}>
            <Printer size={16} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onExcel} title={t('common.excel')} aria-label={t('common.excel')}>
            <FileSpreadsheet size={16} />
          </Button>
          <Button variant="ghost" size="sm" onClick={onPdf} title={t('common.pdf')} aria-label={t('common.pdf')}>
            <FileDown size={16} />
          </Button>
        </>
      )}
      <Button variant="secondary" onClick={() => navigate(backPath)}>{t('common.cancel')}</Button>
      <Button variant="primary" leftIcon={<Save size={16} />} onClick={() => save(false)} isLoading={saving}>
        {t('common.save')}
      </Button>
      {(!isEdit || status === 'draft') && (
        <Button variant="outline" leftIcon={<Send size={16} />} onClick={() => save(true)} isLoading={saving}>
          {t('common.post')}
        </Button>
      )}
    </>
  );

  if (loading) {
    return <div className="min-h-dvh flex items-center justify-center text-sm text-zinc-500">{t('common.loading')}</div>;
  }

  return (
    <DocumentPageShell
      title={title}
      subtitle={docNumber || undefined}
      onBack={() => guardNavigate(() => navigate(backPath))}
      statusBadge={
        <div className="flex items-center gap-2 shrink-0">
          {isDirty && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              {t('common.unsavedChanges')}
            </span>
          )}
          <StatusBadge status={status} size="md" />
        </div>
      }
      headerActions={actions}
      footerActions={actions}
      summary={<TotalsPanel totals={{ subtotal: amt, discountAmount: 0, vatAmount: 0, totalAmount: amt }} formatCurrency={formatCurrency} />}
    >
      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {isReceipt ? (
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-zinc-500 dark:text-zinc-400">{t('accounting.customer')}</label>
              <CustomerSelect
                companyId={companyId}
                value={partyId || undefined}
                onChange={(v) => setPartyId(v ?? '')}
                onCustomerChange={(c) => setPartyName(c.name)}
                selectedLabel={partyName || undefined}
                placeholder={t('accounting.selectCustomer')}
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-zinc-500 dark:text-zinc-400">{t('accounting.supplier')}</label>
                <SupplierSelect
                  companyId={companyId}
                  value={partyId || undefined}
                  onChange={(v) => setPartyId(v ?? '')}
                  onSupplierChange={(s) => setPartyName(s.name)}
                  selectedLabel={partyName || undefined}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5 text-zinc-500 dark:text-zinc-400">
                  {t('accounting.expenseAccount')} <span className="text-zinc-400 font-normal">({t('common.or')})</span>
                </label>
                <AccountSelect
                  companyId={companyId}
                  value={expenseAccountId || undefined}
                  onChange={(v) => setExpenseAccountId(v ?? '')}
                  onAccountChange={(a) => setExpenseAccountName(a.nameAr)}
                  selectedLabel={expenseAccountName || undefined}
                  filterType="expense"
                />
              </div>
            </>
          )}
          <Input label={t('common.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input label={t('accounting.amount')} type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} size="lg" className="font-semibold text-lg" />
          <div>
            <label className="block text-xs font-semibold mb-1.5 text-zinc-500 dark:text-zinc-400">{t('accounting.paymentMethod')}</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="w-full min-h-11 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 text-sm"
              aria-label={t('accounting.paymentMethod')}
            >
              <option value="cash">{t('accounting.voucher.methodCash')}</option>
              <option value="bank">{t('accounting.voucher.methodBank')}</option>
              <option value="check">{t('accounting.voucher.methodCheck')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5 text-zinc-500 dark:text-zinc-400">{t('select.cashBox.placeholder')}</label>
            <CashBoxSelect companyId={companyId} value={cashBoxId || undefined} onChange={(v) => setCashBoxId(v ?? '')} />
          </div>
          {paymentMethod === 'check' && (
            <>
              <Input label={t('accounting.checkNumber')} value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
              <Input label={t('accounting.checkDate')} type="date" value={checkDate} onChange={(e) => setCheckDate(e.target.value)} />
            </>
          )}
          {showReference && (
            <Input
              label={t('common.reference')}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t('common.referenceHint')}
            />
          )}
          <Input label={t('common.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} className="sm:col-span-2 lg:col-span-3" />
        </div>
      </Card>
      <UnsavedChangesDialog blocked={blocked} onLeave={proceed} onStay={reset} />
    </DocumentPageShell>
  );
};

export const ReceiptVoucherEditorPage: React.FC = () => <VoucherEditorPage type="receipt" />;
export const PaymentVoucherEditorPage: React.FC = () => <VoucherEditorPage type="payment" />;
export default ReceiptVoucherEditorPage;
