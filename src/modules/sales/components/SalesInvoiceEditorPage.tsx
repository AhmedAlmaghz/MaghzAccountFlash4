import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, Send, Printer, FileSpreadsheet, FileDown } from 'lucide-react';
import { Card, Button, Input } from '@/core/ui/components';
import { DocumentPageShell, DocumentItemsGrid, TotalsPanel, useDocumentEditorGuard, useRestoreDraft, UnsavedChangesDialog, type DocumentLine } from '@/core/ui/components/document';
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
import { useDocumentExport, type EditorDocumentData } from '@/core/utils/useDocumentExport';
import { salesApi } from '../api';
import type { SalesInvoice } from '../types';

const emptyLine: DocumentLine = {
  productId: '',
  productName: '',
  quantity: 1,
  unitPrice: 0,
  discountPercent: 0,
  vatPercent: 0,
  unitFactor: 1,
};

export const SalesInvoiceEditorPage: React.FC = () => {
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

  const backPath = '/sales/invoices';
  const draft = useMemo(() => ({ customerId, customerName, date, dueDate, currencyCode, exchangeRate, paymentType, cashBoxId, notes, lines }), [customerId, customerName, date, dueDate, currencyCode, exchangeRate, paymentType, cashBoxId, notes, lines]);
  const { blocked, proceed, reset, guardNavigate, clearDraft, isDirty } = useDocumentEditorGuard('sales-invoice', draft, loading, isEdit, saving, !loading && currenciesLoaded);

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
      const seq = await getNextNumber('sales_invoice', companyId);
      if (!cancelled && seq.success && seq.number) setDocNumber(seq.number);
    })();
    return () => {
      cancelled = true;
    };
  }, [isEdit, companyId, getNextNumber]);

  const loadDoc = useCallback(async () => {
    if (!id || !companyId) return;
    setLoading(true);
    const res = await salesApi.getInvoiceById(id, companyId);
    setLoading(false);
    if (res?.success && res.data) {
      const inv = res.data as SalesInvoice;
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
      setDocNumber(inv.invoiceNumber ?? '');
      setDocVersion(inv.docVersion ?? 1);
      setLines(
        (inv.lines ?? []).map((l) => ({
          productId: l.productId,
          productName: l.productName ?? '',
          productCode: l.productCode,
          unitId: l.unitId,
          unitFactor: l.unitFactor,
          baseQuantity: l.baseQuantity,
          unitName: l.unitName,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent ?? 0,
          vatPercent: l.vatPercent ?? 0,
        }))
      );
    } else {
      addToast('error', res?.error || t('common.noResults'));
    }
  }, [id, companyId, addToast, t]);
  useEffect(() => { void loadDoc(); }, [loadDoc]);

  // Restore a previous draft when creating (best-effort, no toast).
  const draftSetters = useMemo(
    () => ({
      customerId: setCustomerId,
      customerName: setCustomerName,
      date: setDate,
      dueDate: setDueDate,
      currencyCode: setCurrencyCode,
      exchangeRate: setExchangeRate,
      paymentType: setPaymentType,
      cashBoxId: setCashBoxId,
      notes: setNotes,
      lines: setLines,
    }),
    []
  );
  useRestoreDraft('sales-invoice', isEdit, draftSetters);

  const totals = useMemo(() => {
    const vatRate = settings?.vatRate ?? 15;
    const showVat = settings?.invoiceShowVat ?? true;
    const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - (l.discountPercent || 0) / 100), 0);
    const vatAmount = showVat ? roundMoney(subtotal * vatRate / 100) : 0;
    return { subtotal: roundMoney(subtotal), discountAmount: 0, vatAmount, totalAmount: roundMoney(subtotal + vatAmount), itemsCount: lines.length };
  }, [lines, settings?.vatRate, settings?.invoiceShowVat]);

  // Print / Excel / PDF from the editor's LIVE state — useful for a draft
  // preview as well as a loaded invoice (same as the old modal's detail view).
  const exportData: EditorDocumentData = useMemo(() => ({
    type: 'sales-invoice',
    docNumber: docNumber || t('sales.invoice.new'),
    date,
    dueDate,
    partyName: customerName || t('accounting.customer'),
    partyLabel: t('sales.customer.title'),
    lines,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    vatAmount: totals.vatAmount,
    totalAmount: totals.totalAmount,
    notes,
    currency: activeCompany?.currency,
    vatRate: settings?.invoiceShowVat === false ? 0 : settings?.vatRate,
    paymentType,
    statusBadge: status,
    company: activeCompany ? {
      name: activeCompany.name, taxNumber: activeCompany.taxNumber, address: activeCompany.address,
      phone: activeCompany.phone, email: activeCompany.email, logoUrl: activeCompany.logoUrl,
    } : undefined,
  }), [docNumber, t, date, dueDate, customerName, lines, totals, notes, activeCompany, settings?.invoiceShowVat, settings?.vatRate, paymentType, status]);
  const { onPrint, onExcel, onPdf } = useDocumentExport(exportData, t);

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
      invoiceNumber: docNumber,
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
          productId: l.productId,
          productName: l.productName,
          quantity: l.quantity,
          unitId: l.unitId,
          unitFactor: l.unitFactor,
          baseQuantity: l.baseQuantity ?? l.quantity * (l.unitFactor ?? 1),
          unitName: l.unitName,
          unitPrice: l.unitPrice,
          discountPercent: l.discountPercent,
          vatPercent: l.vatPercent,
          lineTotal: roundMoney(l.quantity * l.unitPrice * (1 - (l.discountPercent || 0) / 100)),
        })),
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        vatAmount: totals.vatAmount,
        totalAmount: totals.totalAmount,
      };
      const result =
        isEdit && id
          ? await salesApi.updateInvoice(id, companyId, payload as never, user?.id)
          : await salesApi.createInvoice(payload as never, user?.id);
      setSaving(false);
      if (result?.success) {
        clearDraft();
        addToast('success', t('common.saved'));
        const createdId = ('id' in result ? (result.id as string | undefined) : id) ?? id;
        if (post && createdId) {
          await salesApi.postInvoice(String(createdId), companyId, user?.id);
        }
        navigate(backPath);
      } else {
        const errText = String((result?.error as string) || t('common.error'));
        if (errText.includes('Document was modified by another user')) {
          // Optimistic-lock conflict — another user saved the document between
          // load and save. Toast + refetch so the user re-loads the form.
          addToast('error', t('sales.invoice.docConflict'));
          void loadDoc();
        } else {
          addToast('error', errText);
        }
      }
    },
    [companyId, customerId, date, dueDate, currencyCode, exchangeRate, paymentType, cashBoxId, notes, lines, totals, isEdit, id, user?.id, addToast, t, navigate, clearDraft, docNumber]
  );

  const title = isEdit ? t('sales.invoice.edit') : t('sales.invoice.new');
  const actions = (
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
          <div>
            <label className="block text-xs font-semibold mb-1.5 text-zinc-500 dark:text-zinc-400">{t('sales.customer.title')}</label>
            <CustomerSelect companyId={companyId} value={customerId || undefined} onChange={(v) => setCustomerId(v ?? '')}
              onCustomerChange={(x) => setCustomerName(x.name)}
              selectedLabel={customerName || undefined} />
          </div>
          <Input label={t('common.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input label={t('common.dueDate')} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <div>
            <label className="block text-xs font-semibold mb-1.5 text-zinc-500 dark:text-zinc-400">{t('common.currency')}</label>
            <CurrencySelect companyId={companyId} value={currencyCode} onChange={(v) => setCurrencyCode(v ?? YER_CODE)} />
          </div>
          <Input label={t('sales.exchangeRate')} type="number" step="any" inputMode="decimal" value={String(exchangeRate)} onChange={(e) => setExchangeRate(Number(e.target.value) || 1)} />
          <div>
            <label className="block text-xs font-semibold mb-1.5 text-zinc-500 dark:text-zinc-400">{t('common.paymentType')}</label>
            <select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as 'cash' | 'credit')}
              className="w-full min-h-11 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3.5 text-sm"
              aria-label={t('common.paymentType')}
            >
              <option value="credit">{t('sales.payment.credit')}</option>
              <option value="cash">{t('sales.payment.cash')}</option>
            </select>
          </div>
          {paymentType === 'cash' && (
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-zinc-500 dark:text-zinc-400">{t('select.cashBox.placeholder')}</label>
              <CashBoxSelect companyId={companyId} value={cashBoxId || undefined} onChange={(v) => setCashBoxId(v ?? '')} />
            </div>
          )}
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <DocumentItemsGrid
          companyId={companyId}
          lines={lines}
          onChange={setLines}
          showDiscount={settings?.invoiceShowDiscount ?? true}
          showVat={settings?.invoiceShowVat ?? true}
          priceType="sale"
        />
      </Card>

      <Card className="p-4 sm:p-5">
        <Input label={t('common.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('common.notesPlaceholder')} />
      </Card>
      <UnsavedChangesDialog blocked={blocked} onLeave={proceed} onStay={reset} />
    </DocumentPageShell>
  );
};



export default SalesInvoiceEditorPage;
