import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save } from 'lucide-react';
import { Card, Button, Input } from '@/core/ui/components';
import { DocumentPageShell, TotalsPanel, useDocumentEditorGuard, useRestoreDraft, UnsavedChangesDialog } from '@/core/ui/components/document';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { CustomerSelect, SupplierSelect, CashBoxSelect } from '@/core/ui/components/smart';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useFormatters } from '@/core/utils/useFormatters';
import { todayIso } from '@/core/utils/aging';
import { getNextDocumentNumber } from '@/core/api';
import { accountingApi } from '../api';

export const VoucherEditorPage: React.FC<{ type: 'receipt' | 'payment' }> = ({ type }) => {
  const { t } = useTranslation();
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((s) => s.activeCompany);
  const user = useAuthStore((s) => s.user);
  const companyId = activeCompany?.id || '';
  const { formatCurrency } = useFormatters(companyId);

  const isEdit = Boolean(id);
  const isReceipt = type === 'receipt';
  const backPath = isReceipt ? '/accounting/receipt-vouchers' : '/accounting/payment-vouchers';

  const [partyId, setPartyId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('0');
  const [cashBoxId, setCashBoxId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const [status, setStatus] = useState<string>('draft');
  const { blocked, proceed, reset, guardNavigate, clearDraft, isDirty } = useDocumentEditorGuard(isReceipt ? 'receipt-voucher' : 'payment-voucher', { partyId, date, amount, cashBoxId, notes }, loading, isEdit, saving);
  const draftSetters = useMemo(() => ({ partyId: setPartyId, date: setDate, amount: setAmount, cashBoxId: setCashBoxId, notes: setNotes }), []);
  useRestoreDraft('voucher', isEdit, draftSetters);

  useEffect(() => {
    let cancelled = false;
    if (!id || !companyId) return;
    setLoading(true);
    (async () => {
      const list = isReceipt
        ? await accountingApi.getReceiptVouchers(companyId)
        : await accountingApi.getPaymentVouchers(companyId);
      const row = (list?.data ?? []).find((v) => v.id === id);
      const res = row ? { success: true, data: row } : { success: false, data: undefined, error: 'not found' };
      if (cancelled) return;
      setLoading(false);
      if (res?.success && res.data) {
        const v = res.data as { customerId?: string; supplierId?: string; date?: string; amount?: number; cashBoxId?: string; notes?: string; status?: string };
        setPartyId((v.customerId ?? v.supplierId) || '');
        setDate(v.date ?? todayIso());
        setAmount(String(v.amount ?? 0));
        setCashBoxId(v.cashBoxId ?? '');
        setNotes(v.notes ?? '');
        setStatus(v.status ?? 'draft');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, companyId, isReceipt]);

  const save = useCallback(async (post?: boolean) => {
    if (!companyId || !partyId || Number(amount) <= 0) {
      addToast('error', t('validation.required'));
      return;
    }
    setSaving(true);
    // The create* schema requires companyId, voucherNumber and paymentMethod.
    // The API validates the payload exactly as it arrives (it never injects
    // the tenant and never generates the number), so a missing field fails
    // validation and the save silently does nothing.
    let voucherNumber = '';
    if (!isEdit || !id) {
      const seq = await getNextDocumentNumber(companyId, isReceipt ? 'receipt_voucher' : 'payment_voucher');
      if (!seq.success || !seq.number) {
        setSaving(false);
        addToast('error', seq.error || t('accounting.voucherNumberError'));
        return;
      }
      voucherNumber = seq.number;
    }
    const shared = {
      companyId,
      voucherNumber,
      date,
      amount: Number(amount) || 0,
      cashBoxId: cashBoxId || undefined,
      paymentMethod: 'cash',
      notes: notes || undefined,
      status: post ? 'posted' : 'draft',
    };
    const payload = isReceipt
      ? { ...shared, customerId: partyId || undefined }
      : { ...shared, supplierId: partyId || undefined };
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
  }, [companyId, partyId, date, amount, cashBoxId, notes, isReceipt, isEdit, id, user?.id, addToast, t, navigate, backPath, clearDraft]);

  const title = isEdit
    ? t('accounting.editVoucher')
    : (isReceipt ? t('accounting.newReceiptVoucher') : t('accounting.newPaymentVoucher'));
  const amt = Number(amount) || 0;
  const actions = (
    <>
      <Button variant="secondary" onClick={() => navigate(backPath)}>{t('common.cancel')}</Button>
      <Button variant="primary" leftIcon={<Save size={16} />} onClick={() => save(false)} isLoading={saving}>{t('common.save')}</Button>
      <Button variant="outline" onClick={() => save(true)} isLoading={saving}>{t('common.post')}</Button>
    </>
  );

  if (loading) {
    return <div className="min-h-dvh flex items-center justify-center text-sm text-zinc-500">{t('common.loading')}</div>;
  }

  return (
    <DocumentPageShell
      title={title}
      subtitle={isReceipt ? t('accounting.receiptVouchers') : t('accounting.paymentVouchers')}
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
      <Card className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {isReceipt ? (
          <CustomerSelect companyId={companyId} value={partyId || undefined} onChange={(v) => setPartyId(v ?? '')} />
        ) : (
          <SupplierSelect companyId={companyId} value={partyId || undefined} onChange={(v) => setPartyId(v ?? '')} />
        )}
        <Input label={t('common.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label={t('accounting.amount')} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <CashBoxSelect companyId={companyId} value={cashBoxId || undefined} onChange={(v) => setCashBoxId(v ?? '')} />
        <Input label={t('common.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} className="sm:col-span-2" />
      </Card>
      <UnsavedChangesDialog blocked={blocked} onLeave={proceed} onStay={reset} />
    </DocumentPageShell>
  );
};

export const ReceiptVoucherEditorPage: React.FC = () => <VoucherEditorPage type="receipt" />;
export const PaymentVoucherEditorPage: React.FC = () => <VoucherEditorPage type="payment" />;
export default ReceiptVoucherEditorPage;

