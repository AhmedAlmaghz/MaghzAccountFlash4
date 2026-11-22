import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, Send } from 'lucide-react';
import { Card, Button, Input } from '@/core/ui/components';
import { DocumentPageShell, DocumentItemsGrid, TotalsPanel, useRestoreDraft, useDocumentEditorGuard, UnsavedChangesDialog, type DocumentLine } from '@/core/ui/components/document';
import { CustomerSelect, CurrencySelect, CashBoxSelect } from '@/core/ui/components/smart';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useSettings } from '@/core/utils/useSettings';
import { useFormatters } from '@/core/utils/useFormatters';
import { useCurrencyDisplay } from '@/core/utils/useCurrencyDisplay';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { roundMoney } from '@/core/utils/locale';
import { todayIso } from '@/core/utils/aging';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { salesApi } from '../api';


const emptyLine: DocumentLine = {
  productId: '',
  productName: '',
  quantity: 1,
  unitPrice: 0,
  unitFactor: 1,
};

export const SalesReturnEditorPage: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((s) => s.activeCompany);
  const user = useAuthStore((s) => s.user);
  const companyId = activeCompany?.id || '';
  const { getNextNumber } = useDocumentSequence();
  const { settings } = useSettings(companyId);
  const { formatCurrency } = useFormatters(companyId);
  const { currencies, currenciesLoaded } = useCurrencyDisplay();

  const isEdit = Boolean(id);
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [date, setDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [currencyCode, setCurrencyCode] = useState(YER_CODE);
  const [exchangeRate, setExchangeRate] = useState(1);
  const [paymentType, setPaymentType] = useState<'cash' | 'credit'>('credit');
  const [cashBoxId, setCashBoxId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DocumentLine[]>([emptyLine]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const [status, setStatus] = useState<string>('draft');
  const [docNumber, setDocNumber] = useState('');
  const [docVersion, setDocVersion] = useState(1);

  const backPath = '/sales/returns';
  const draft = useMemo(() => ({ customerId, customerName, date, dueDate, currencyCode, exchangeRate, paymentType, cashBoxId, notes, lines }), [customerId, customerName, date, dueDate, currencyCode, exchangeRate, paymentType, cashBoxId, notes, lines]);
  const { blocked, proceed, reset, guardNavigate, clearDraft, isDirty } = useDocumentEditorGuard('sales-return', draft, loading, isEdit, saving, !loading && currenciesLoaded);
  const draftSetters = useMemo(() => ({ customerId: setCustomerId, date: setDate, dueDate: setDueDate, currencyCode: setCurrencyCode, exchangeRate: setExchangeRate, paymentType: setPaymentType, cashBoxId: setCashBoxId, notes: setNotes, lines: setLines }), []);
  useRestoreDraft('sales-return', isEdit, draftSetters);

  useEffect(() => {
    if (!currencyCode) return;
    const cur = currencies.find((c) => c.code === currencyCode);
    if (cur?.exchangeRate) setExchangeRate(cur.exchangeRate);
  }, [currencyCode, currencies]);

  // Reserve the document number: the create* schema requires it and the API
  // never generates one — a missing number fails validation and the save
  // silently does nothing.
  useEffect(() => {
    if (isEdit || !companyId) return;
    let cancelled = false;
    (async () => {
      const seq = await getNextNumber('sales_return', companyId);
      if (!cancelled && seq.success && seq.number) setDocNumber(seq.number);
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, companyId, getNextNumber]);

  useEffect(() => {
    let cancelled = false;
    if (!id || !companyId) return;
    setLoading(true);
    (async () => {
      const res = await salesApi.getReturnById(id, companyId);
      if (cancelled) return;
      setLoading(false);
      if (res?.success && res.data) {
        const inv = res.data as unknown as { customerId?: string; customer?: { name?: string }; returnNumber?: string; supplierId?: string; docVersion?: number; date?: string; dueDate?: string; expiryDate?: string; expectedDate?: string; currencyCode?: string; exchangeRate?: number; paymentType?: string; cashBoxId?: string; notes?: string; reason?: string; status?: string; lines?: Array<{ productId?: string; productName?: string; productCode?: string; unitId?: string; unitFactor?: number; baseQuantity?: number; unitName?: string; quantity?: number; unitPrice?: number }>; };
        setCustomerId(inv.customerId ?? '');
        setCustomerName(inv.customer?.name ?? '');
        setDate(inv.date ?? todayIso());
        setDueDate(inv.dueDate ?? '');
        setCurrencyCode(inv.currencyCode ?? YER_CODE);
        setExchangeRate(inv.exchangeRate ?? 1);
        setPaymentType(inv.paymentType === 'cash' ? 'cash' : 'credit');
        setCashBoxId(inv.cashBoxId ?? '');
        setNotes(inv.notes ?? '');
        setStatus(inv.status ?? 'draft');
        setDocNumber(inv.returnNumber ?? '');
        setDocVersion(inv.docVersion ?? 1);
        setLines(
          (inv.lines ?? []).map((l) => ({
            productId: l.productId ?? '',
            productName: l.productName ?? '',
            productCode: l.productCode,
            unitId: l.unitId,
            unitFactor: l.unitFactor,
            baseQuantity: l.baseQuantity,
            unitName: l.unitName,
            quantity: l.quantity ?? 1,
            unitPrice: l.unitPrice ?? 0,
          }))
        );
      } else {
        addToast('error', res?.error || t('common.noResults'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, companyId, addToast, t]);

  const totals = useMemo(() => {
    const vatRate = settings?.vatRate ?? 15;
    const showVat = settings?.invoiceShowVat ?? true;
    const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const vatAmount = showVat ? roundMoney(subtotal * vatRate / 100) : 0;
    return { subtotal: roundMoney(subtotal), discountAmount: 0, vatAmount, totalAmount: roundMoney(subtotal + vatAmount), itemsCount: lines.length };
  }, [lines, settings?.vatRate, settings?.invoiceShowVat]);

  const save = useCallback(
    async (post?: boolean) => {
      if (!companyId) return;
      if (!customerId) {
        addToast('error', t('validation.required'));
        return;
      }
      if (lines.length === 0 || lines.some((l) => !l.productId || l.quantity <= 0)) {
        addToast('error', t('sales.invoice.productRequired'));
        return;
      }
      if (paymentType === 'cash' && !cashBoxId) {
        addToast('error', t('validation.required'));
        return;
      }
      setSaving(true);
      const payload = {
      // companyId is REQUIRED by the create* schema — the API validates the
      // payload exactly as it arrives and never injects the tenant, so a
      // missing companyId fails validation and the save silently does
      // nothing (no request, no error the user can act on).
      companyId,
      returnNumber: docNumber,
      expectedVersion: isEdit ? docVersion : undefined,
        customerId: customerId || undefined,
        date,
        dueDate: dueDate || undefined,
        currencyCode,
        exchangeRate: exchangeRate || 1,
        baseCurrencyAmount: roundMoney(totals.totalAmount * (exchangeRate || 1)),
        paymentType,
        cashBoxId: paymentType === 'cash' ? cashBoxId || undefined : undefined,
        notes: notes || undefined,
        status: post ? 'posted' : 'draft',
        lines: lines.map((l) => ({
          productId: l.productId ?? '',
          productName: l.productName,
          quantity: l.quantity ?? 1,
          unitId: l.unitId,
          unitFactor: l.unitFactor,
          baseQuantity: l.baseQuantity ?? l.quantity * (l.unitFactor ?? 1),
          unitName: l.unitName,
          unitPrice: l.unitPrice ?? 0,
          lineTotal: roundMoney(l.quantity * l.unitPrice),
        })),
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        vatAmount: totals.vatAmount,
        totalAmount: totals.totalAmount,
      };
      const result =
        isEdit && id
          ? await salesApi.updateReturn(id, companyId, payload as never, user?.id)
          : await salesApi.createReturn(payload as never, user?.id);
      setSaving(false);
      if (result?.success) {
        clearDraft();
        addToast('success', t('common.saved'));
        const createdId = ('id' in result ? (result.id as string | undefined) : id) ?? id;
        if (post && createdId) {
          await salesApi.postReturn(String(createdId), companyId, user?.id);
        }
        navigate(backPath);
      } else {
        const errText = String((result?.error as string) || t('common.error'));
        if (errText.includes('Document was modified by another user')) {
          addToast('error', t('sales.invoice.docConflict'));
        } else {
          addToast('error', errText);
        }
      }
    },
    [companyId, customerId, date, dueDate, currencyCode, exchangeRate, paymentType, cashBoxId, notes, lines, totals, isEdit, id, user?.id, addToast, t, navigate, clearDraft, docNumber, docVersion]
  );

  const title = isEdit ? t('sales.return.edit') : t('sales.return.new');
  const actions = (
    <>
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
      summary={<TotalsPanel totals={totals} formatCurrency={formatCurrency} vatRate={settings?.invoiceShowVat === false ? 0 : settings?.vatRate} />}
    >
      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <CustomerSelect companyId={companyId} value={customerId || undefined} onChange={(v) => setCustomerId(v ?? '')}
                onCustomerChange={(x) => setCustomerName(x.name)}
                selectedLabel={customerName || undefined} />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <CurrencySelect companyId={companyId} value={currencyCode} onChange={(v) => setCurrencyCode(v ?? YER_CODE)} />
          <Input type="number" value={String(exchangeRate)} onChange={(e) => setExchangeRate(Number(e.target.value) || 1)} />
          <div>
            <label className="block text-xs font-semibold mb-1.5">{t('common.paymentType')}</label>
            <select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as 'cash' | 'credit')}
              className="w-full min-h-11 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm"
              aria-label={t('common.paymentType')}
            >
              <option value="credit">{t('sales.payment.credit')}</option>
              <option value="cash">{t('sales.payment.cash')}</option>
            </select>
          </div>
          {paymentType === 'cash' && (
            <CashBoxSelect companyId={companyId} value={cashBoxId || undefined} onChange={(v) => setCashBoxId(v ?? '')} />
          )}
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <DocumentItemsGrid
          companyId={companyId}
          lines={lines}
          onChange={setLines}
          priceType="sale"
        />
      </Card>

      <Card className="p-4 sm:p-5">
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('common.notesPlaceholder')} />
      </Card>
      <UnsavedChangesDialog blocked={blocked} onLeave={proceed} onStay={reset} />
    </DocumentPageShell>
  );
};



export default SalesReturnEditorPage;



