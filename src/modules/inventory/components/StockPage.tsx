import React, { useState, useMemo, useCallback } from 'react';
import { Boxes, ArrowRightLeft, Plus, Scale, AlertTriangle, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card, Button, Input, Modal, Table, Can } from '@/core/ui/components';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { ProductSelect, WarehouseSelect } from '@/core/ui/components/smart';
import { useStockDetailed, useStockTransfers } from '../hooks/useInventory';
import { useAppStore } from '@/core/store';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import type { StockItem, StockTransfer } from '../types';

export const StockPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const { stock, isLoading } = useStockDetailed(activeCompany?.id || '');
  const { transfers, create: createTransfer, complete: completeTransfer, remove: removeTransfer } = useStockTransfers(activeCompany?.id || '');
  const { getNextNumber } = useDocumentSequence();

  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmComplete, setConfirmComplete] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [transferForm, setTransferForm] = useState({
    productId: '',
    fromWarehouseId: '',
    toWarehouseId: '',
    quantity: '',
    date: new Date().toISOString().split('T')[0],
    transferNumber: '',
    reference: '',
    notes: '',
  });

  const resetForm = useCallback(() => {
    setTransferForm({
      productId: '',
      fromWarehouseId: '',
      toWarehouseId: '',
      quantity: '',
      date: new Date().toISOString().split('T')[0],
      transferNumber: '',
      reference: '',
      notes: '',
    });
  }, []);

  const closeModal = useCallback(() => {
    setIsTransferOpen(false);
    resetForm();
  }, [resetForm]);

  const handleCreateTransfer = async () => {
    if (!activeCompany) return;
    if (!transferForm.productId || !transferForm.fromWarehouseId || !transferForm.toWarehouseId) {
      addToast('error', 'الرجاء إكمال جميع الحقول المطلوبة');
      return;
    }
    if (transferForm.fromWarehouseId === transferForm.toWarehouseId) {
      addToast('error', 'مستودع المصدر والوجهة يجب أن يكونا مختلفين');
      return;
    }
    if (!transferForm.quantity || Number(transferForm.quantity) <= 0) {
      addToast('error', 'الكمية يجب أن تكون أكبر من صفر');
      return;
    }
    setSaving(true);
    try {
      const result = await createTransfer({
        companyId: activeCompany.id,
        productId: transferForm.productId,
        fromWarehouseId: transferForm.fromWarehouseId,
        toWarehouseId: transferForm.toWarehouseId,
        quantity: Number(transferForm.quantity),
        date: transferForm.date,
        transferNumber: transferForm.transferNumber,
        reference: transferForm.reference || undefined,
        notes: transferForm.notes || undefined,
        status: 'draft',
      });
      if (result.success) {
        addToast('success', 'تم إنشاء التحويل بنجاح');
        closeModal();
      } else {
        addToast('error', result.error || t('common.error'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteTransfer = async (id: string) => {
    const result = await completeTransfer(id);
    if (result.success) {
      addToast('success', 'تم إكمال التحويل بنجاح');
    } else {
      addToast('error', result.error || t('common.error'));
    }
    setConfirmComplete(null);
  };

  const handleDeleteTransfer = async (id: string) => {
    const result = await removeTransfer(id);
    if (result.success) {
      addToast('success', 'تم حذف التحويل بنجاح');
    } else {
      addToast('error', result.error || t('common.error'));
    }
    setConfirmDelete(null);
  };

  const stockColumns = useMemo(() => [
    { key: 'productCode', header: t('inventory.productCode'), width: '120px', render: (row: StockItem) => <span className="font-mono text-xs">{row.productCode || '-'}</span> },
    { key: 'productName', header: t('inventory.productName') },
    { key: 'warehouseName', header: t('inventory.warehouse') },
    { key: 'quantity', header: t('inventory.quantity'), align: 'right' as const, render: (row: StockItem) => <span className="font-semibold">{row.quantity}</span> },
    { key: 'unit', header: t('inventory.unitPrice'), width: '80px' },
    { key: 'minStockAlert', header: t('inventory.minStock'), align: 'right' as const, render: (row: StockItem) => row.minStockAlert ?? '-' },
    { key: 'alert', header: '', width: '60px', render: (row: StockItem) => {
      if (row.minStockAlert !== undefined && row.minStockAlert !== null && row.quantity < row.minStockAlert) {
        return <AlertTriangle size={16} className="text-amber-500" aria-label={t('inventory.lowStock')} />;
      }
      return null;
    }},
  ], [t]);

  const transferColumns = useMemo(() => [
    { key: 'date', header: t('inventory.date'), render: (row: StockTransfer) => new Date(row.date).toLocaleDateString('ar-EG') },
    { key: 'transferNumber', header: t('inventory.transferNumber'), render: (row: StockTransfer) => row.transferNumber || '-' },
    { key: 'reference', header: t('inventory.reference'), render: (row: StockTransfer) => row.reference || '-' },
    { key: 'fromWarehouseName', header: t('inventory.fromWarehouse'), render: (row: StockTransfer) => row.fromWarehouseName || row.fromWarehouseId?.slice(0, 8) || '-' },
    { key: 'toWarehouseName', header: t('inventory.toWarehouse'), render: (row: StockTransfer) => row.toWarehouseName || row.toWarehouseId?.slice(0, 8) || '-' },
    { key: 'totalQuantity', header: t('inventory.quantity'), align: 'right' as const, render: (row: StockTransfer) => (
      <span>
        {row.totalQuantity !== undefined ? row.totalQuantity : row.quantity || 0}
        {row.linesCount !== undefined && row.linesCount > 1 && (
          <span className="text-xs text-slate-500 mr-1">({row.linesCount} منتج)</span>
        )}
      </span>
    )},
    { key: 'status', header: t('inventory.status'), render: (row: StockTransfer) => <StatusBadge status={row.status} /> },
    { key: 'actions', header: '', width: '140px', render: (row: StockTransfer) => (
      <div className="flex items-center gap-1">
        {row.status === 'draft' && (
          <Button size="sm" variant="ghost" onClick={() => setConfirmComplete(row.id)} title={t('inventory.complete') || 'إكمال'}>
            <CheckCircle size={14} className="text-emerald-600" />
          </Button>
        )}
        <ActionButtons
          onView={undefined}
          onEdit={undefined}
          onDelete={() => setConfirmDelete(row.id)}
          showView={false}
          showEdit={false}
          showPrint={false}
          showExport={false}
        />
      </div>
    )},
  ], [t]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Boxes size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('inventory.stock')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('inventory.stockByWarehouse')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" leftIcon={<Scale size={16} />} onClick={() => navigate('/inventory/adjustments')}>
            {t('inventory.adjustments')}
          </Button>
          <Can action="create" module="inventory">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={async () => {
              resetForm();
              if (activeCompany) {
                const seq = await getNextNumber('inventory_transfer', activeCompany.id);
                if (seq?.number) setTransferForm(prev => ({ ...prev, transferNumber: seq.number || '' }));
              }
              setIsTransferOpen(true);
            }}>
              {t('inventory.newTransfer')}
            </Button>
          </Can>
        </div>
      </div>

      <Card>
        {stock.length === 0 && !isLoading ? (
          <EmptyState icon="inbox" title={t('inventory.empty.stock.title')} description={t('inventory.empty.stock.description')} />
        ) : (
          <Table<StockItem>
            data={stock}
            columns={stockColumns}
            keyExtractor={(row) => row.id}
            isLoading={isLoading}
            emptyMessage=""
          />
        )}
      </Card>

      {/* Transfers Section */}
      <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
            <ArrowRightLeft size={20} />
            {t('inventory.transfers')}
          </h2>
          <span className="text-sm text-slate-500">({transfers.length})</span>
        </div>
        <Card>
          {transfers.length === 0 && !isLoading ? (
            <EmptyState icon="inbox" title={t('inventory.empty.transfers.title')} description={t('inventory.empty.transfers.description')} />
          ) : (
            <Table<StockTransfer>
              data={transfers}
              columns={transferColumns}
              keyExtractor={(row) => row.id}
            />
          )}
        </Card>
      </div>

      {/* Transfer Modal */}
      <Modal
        isOpen={isTransferOpen}
        onClose={closeModal}
        title={t('inventory.newTransfer')}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleCreateTransfer} disabled={saving}>
              {saving ? t('common.loading') : t('save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg mb-2">
            <span className="text-sm text-slate-500">{t('inventory.transferNumber')}:</span>
            <span className="font-semibold text-sm font-mono">{transferForm.transferNumber || t('inventory.autoGenerate')}</span>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('inventory.productName')} *</label>
            <ProductSelect companyId={activeCompany?.id || ''} value={transferForm.productId} onChange={v => setTransferForm(prev => ({ ...prev, productId: typeof v === 'string' ? v : '' }))} showBarcode showStock module="inventory" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('inventory.fromWarehouse')} *</label>
              <WarehouseSelect companyId={activeCompany?.id || ''} value={transferForm.fromWarehouseId} onChange={v => setTransferForm(prev => ({ ...prev, fromWarehouseId: typeof v === 'string' ? v : '' }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('inventory.toWarehouse')} *</label>
              <WarehouseSelect companyId={activeCompany?.id || ''} value={transferForm.toWarehouseId} onChange={v => setTransferForm(prev => ({ ...prev, toWarehouseId: typeof v === 'string' ? v : '' }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('inventory.quantity')} type="number" min="0.01" step="0.01" value={transferForm.quantity} onChange={e => setTransferForm(prev => ({ ...prev, quantity: e.target.value }))} required />
            <Input label={t('inventory.date')} type="date" value={transferForm.date} onChange={e => setTransferForm(prev => ({ ...prev, date: e.target.value }))} required />
          </div>
          <Input label={t('inventory.reference')} value={transferForm.reference} onChange={e => setTransferForm(prev => ({ ...prev, reference: e.target.value }))} />
          <Input label={t('inventory.notes')} value={transferForm.notes} onChange={e => setTransferForm(prev => ({ ...prev, notes: e.target.value }))} />
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmComplete}
        onClose={() => setConfirmComplete(null)}
        onConfirm={() => confirmComplete && handleCompleteTransfer(confirmComplete)}
        title="إكمال التحويل"
        message="هل تريد إكمال هذا التحويل؟ سيتم تحديث المخزون في المستودعين."
        variant="info"
      />

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDeleteTransfer(confirmDelete)}
        title={t('delete')}
        message={t('inventory.deleteConfirm')}
        variant="danger"
      />
    </div>
  );
};

export default StockPage;
