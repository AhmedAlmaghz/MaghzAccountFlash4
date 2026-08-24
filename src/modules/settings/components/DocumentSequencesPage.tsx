import React, { useState } from 'react';
import { Hash, RotateCcw, Save, Eye, ToggleLeft, ToggleRight } from 'lucide-react';
import { Card, Button, Table, Input, Can } from '@/core/ui/components';
import { SettingsHeader } from './SettingsHeader';
import { useDocumentSequences } from '@/core/hooks/useSettings';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import type { DocumentSequence } from '@/core/types';

export const DocumentSequencesPage: React.FC = () => {
  const activeCompany = useAppStore(state => state.activeCompany);
  const { sequences, isLoading, update, peekNextNumber } = useDocumentSequences(activeCompany?.id || '');
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [editing, setEditing] = useState<Record<string, Partial<DocumentSequence>>>({});
  const [previewNumber, setPreviewNumber] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const TYPE_LABELS: Record<string, string> = {
    // Sales
    sales_invoice: t('settings.documentTypes.salesInvoice'),
    sales_return: t('settings.documentTypes.salesReturn'),
    quotation: t('settings.documentTypes.quotation'),
    // Purchases
    purchase_invoice: t('settings.documentTypes.purchaseInvoice'),
    purchase_return: t('settings.documentTypes.purchaseReturn'),
    purchase_order: t('settings.documentTypes.purchaseOrder'),
    // Accounting
    journal_voucher: t('settings.documentTypes.journalVoucher'),
    receipt_voucher: t('settings.documentTypes.receiptVoucher'),
    payment_voucher: t('settings.documentTypes.paymentVoucher'),
    // Manufacturing
    work_order: t('settings.documentTypes.workOrder'),
    // Inventory
    stock_adjustment: t('settings.documentTypes.stockAdjustment'),
    inventory_transfer: t('settings.documentTypes.inventoryTransfer'),
    product: t('settings.documentTypes.product'),
    // HR
    payroll_run: t('settings.documentTypes.payrollRun'),
    employee: t('settings.documentTypes.employee'),
    // CRM
    customer: t('settings.documentTypes.customer'),
    supplier: t('settings.documentTypes.supplier'),
  };

  const handleEdit = (id: string, field: keyof DocumentSequence, value: string | number | boolean) => {
    setEditing(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const handleSave = async (seq: DocumentSequence) => {
    const changes = editing[seq.id];
    if (!changes) return;
    setSavingId(seq.id);
    const result = await update(seq.id, changes);
    if (result.success) {
      addToast('success', t('settings.sequences.updated'));
      setEditing(prev => { const n = { ...prev }; delete n[seq.id]; return n; });
    } else {
      addToast('error', result.error || t('settings.sequences.updateError'));
    }
    setSavingId(null);
  };

  const handlePreview = async (seq: DocumentSequence) => {
    const result = await peekNextNumber(seq.documentType);
    if (result.success && result.number) {
      setPreviewNumber(prev => ({ ...prev, [seq.id]: result.number! }));
    } else {
      addToast('error', result.error || t('settings.sequences.previewError'));
    }
  };

  const toggleActive = async (seq: DocumentSequence) => {
    const result = await update(seq.id, { isActive: !seq.isActive });
    if (result.success) {
      addToast('success', t('settings.sequences.updated'));
    } else {
      addToast('error', result.error || t('settings.sequences.updateError'));
    }
  };

  const columns = [
    { key: 'documentType', header: t('settings.sequences.documentType'), width: '160px', render: (row: DocumentSequence) => (
      <div className="flex items-center gap-2">
        <Hash size={14} className="text-primary-500" />
        <span className="font-medium">{TYPE_LABELS[row.documentType] || row.documentType}</span>
      </div>
    )},
    { key: 'prefix', header: t('settings.sequences.prefix'), width: '100px', render: (row: DocumentSequence) => (
      <Input size="sm" value={editing[row.id]?.prefix ?? row.prefix} onChange={e => handleEdit(row.id, 'prefix', e.target.value)} className="w-24" />
    )},
    { key: 'suffix', header: t('settings.sequences.suffix'), width: '80px', render: (row: DocumentSequence) => (
      <Input size="sm" value={editing[row.id]?.suffix ?? row.suffix} onChange={e => handleEdit(row.id, 'suffix', e.target.value)} className="w-20" />
    )},
    { key: 'startNumber', header: t('settings.sequences.startNumber'), width: '100px', render: (row: DocumentSequence) => (
      <Input size="sm" type="number" value={String(editing[row.id]?.startingNumber ?? row.startingNumber)} onChange={e => handleEdit(row.id, 'startingNumber', Number(e.target.value))} className="w-24" />
    )},
    { key: 'currentNumber', header: t('settings.sequences.currentNumber'), width: '100px', render: (row: DocumentSequence) => (
      <Input size="sm" type="number" value={String(editing[row.id]?.currentNumber ?? row.currentNumber)} onChange={e => handleEdit(row.id, 'currentNumber', Number(e.target.value))} className="w-24" />
    )},
    { key: 'incrementStep', header: t('settings.sequences.incrementStep'), width: '100px', render: (row: DocumentSequence) => (
      <Input size="sm" type="number" value={String(editing[row.id]?.incrementStep ?? row.incrementStep)} onChange={e => handleEdit(row.id, 'incrementStep', Number(e.target.value))} className="w-20" />
    )},
    { key: 'paddingLength', header: t('settings.sequences.paddingLength'), width: '80px', render: (row: DocumentSequence) => (
      <Input size="sm" type="number" value={String(editing[row.id]?.paddingLength ?? row.paddingLength)} onChange={e => handleEdit(row.id, 'paddingLength', Number(e.target.value))} className="w-16" />
    )},
    { key: 'yearReset', header: t('settings.sequences.yearReset'), width: '90px', render: (row: DocumentSequence) => (
      <input
        type="checkbox"
        checked={editing[row.id]?.yearReset ?? row.yearReset}
        onChange={e => handleEdit(row.id, 'yearReset', e.target.checked)}
        className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
      />
    )},
    { key: 'isActive', header: t('settings.sequences.active'), width: '80px', render: (row: DocumentSequence) => (
      <Can action="edit" module="settings">
        <button onClick={() => toggleActive(row)} className="focus:outline-none" title={row.isActive ? t('settings.sequences.deactivate') : t('settings.sequences.activate')}>
          {row.isActive ? (
            <ToggleRight size={20} className="text-emerald-500" />
          ) : (
            <ToggleLeft size={20} className="text-slate-400" />
          )}
        </button>
      </Can>
    )},
    { key: 'preview', header: t('settings.sequences.preview'), width: '160px', render: (row: DocumentSequence) => (
      <div className="flex items-center gap-2">
        {previewNumber[row.id] && (
          <span className="text-xs font-mono bg-primary-50 text-primary-700 px-2 py-0.5 rounded border border-primary-100">{previewNumber[row.id]}</span>
        )}
        <Button size="sm" variant="ghost" onClick={() => handlePreview(row)} leftIcon={<Eye size={12} />}>{t('settings.sequences.preview')}</Button>
      </div>
    )},
    { key: 'actions', header: '', width: '80px', render: (row: DocumentSequence) => (
      editing[row.id] ? (
        <Can action="edit" module="settings">
          <Button size="sm" variant="secondary" onClick={() => handleSave(row)} isLoading={savingId === row.id} leftIcon={<Save size={12} />}>{t('settings.common.save')}</Button>
        </Can>
      ) : (
        <Can action="edit" module="settings">
          <Button size="sm" variant="ghost" onClick={() => { setEditing({ [row.id]: { ...row } }); }} leftIcon={<RotateCcw size={12} />}>{t('settings.common.edit')}</Button>
        </Can>
      )
    )},
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      <SettingsHeader
        title={t('settings.sequences.title')}
        subtitle={t('settings.sequences.subtitle')}
        icon={Hash}
        color="from-slate-600 via-slate-500 to-gray-600"
      />
      <Card>
        <Table<DocumentSequence> data={sequences} columns={columns} keyExtractor={(row, i) => row.id || String(i)} isLoading={isLoading} emptyMessage={t('settings.sequences.emptyMessage')} />
      </Card>
    </div>
  );
};

export default DocumentSequencesPage;
