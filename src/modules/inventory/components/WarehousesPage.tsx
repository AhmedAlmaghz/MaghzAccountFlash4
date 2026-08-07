import React, { useState, useCallback, useMemo } from 'react';
import { Warehouse, Plus, Building2 } from 'lucide-react';
import { Card, Button, Input, Modal, Table } from '@/core/ui/components';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { BranchSelect } from '@/core/ui/components/smart';
import { useWarehouses } from '../hooks/useInventory';
import { useStockDetailed } from '../hooks/useInventory';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useFormatters } from '@/core/utils/useFormatters';
import type { Warehouse as WarehouseType, StockItem } from '../types';
import { Can } from '@/core/ui/components/PermissionGate';

interface FormData {
  name: string;
  code: string;
  branchId: string;
  isActive: boolean;
}

const initialForm: FormData = { name: '', code: '', branchId: '', isActive: true };

export const WarehousesPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { warehouses, isLoading, create, update, remove } = useWarehouses(activeCompany?.id || '');
  const { stock } = useStockDetailed(activeCompany?.id || '');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedWarehouse, setSelectedWarehouse] = useState<WarehouseType | null>(null);
  const [saving, setSaving] = useState(false);

  const handleOpenCreate = useCallback(() => {
    setFormData(initialForm);
    setEditingId(null);
    setIsModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((wh: WarehouseType) => {
    setFormData({
      name: wh.name,
      code: wh.code || '',
      branchId: wh.branchId || '',
      isActive: wh.isActive,
    });
    setEditingId(wh.id);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setFormData(initialForm);
    setEditingId(null);
  }, []);

  const handleSave = async () => {
    if (!activeCompany) return;
    if (!formData.name.trim()) {
      addToast('error', 'الرجاء إدخال اسم المستودع');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        companyId: activeCompany.id,
        name: formData.name.trim(),
        code: formData.code.trim() || undefined,
        branchId: formData.branchId || undefined,
        isActive: formData.isActive,
      };

      let result;
      if (editingId) {
        result = await update(editingId, payload);
      } else {
        result = await create(payload);
      }
      if (result?.success) {
        addToast('success', editingId ? t('inventory.warehouse.updated') : t('inventory.warehouse.created'));
        closeModal();
      } else {
        addToast('error', result?.error || t('common.error'));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const result = await remove(id);
    if (result?.success) {
      addToast('success', t('inventory.warehouse.deleted'));
    } else {
      addToast('error', result?.error || t('common.error'));
    }
    setConfirmDelete(null);
  };

  const handleViewStock = useCallback((wh: WarehouseType) => {
    setSelectedWarehouse(wh);
    setIsStockModalOpen(true);
  }, []);

  const warehouseStock = useMemo(() => {
    if (!selectedWarehouse) return [] as StockItem[];
    return stock.filter(s => s.warehouseId === selectedWarehouse.id);
  }, [stock, selectedWarehouse]);

  const warehouseStockValue = useMemo(() => {
    return warehouseStock.reduce((sum, s) => sum + (s.quantity * (s.costPrice || 0)), 0);
  }, [warehouseStock]);

  const columns = useMemo(() => [
    { key: 'code', header: t('inventory.productCode'), render: (row: WarehouseType) => <span className="font-mono text-xs">{row.code || '-'}</span> },
    { key: 'name', header: t('inventory.warehouse'), render: (row: WarehouseType) => <span className="font-medium">{row.name}</span> },
    { key: 'branch', header: t('inventory.branch'), render: (row: WarehouseType) => row.branchId ? <span className="flex items-center gap-1"><Building2 size={14} /> {row.branchId}</span> : '-' },
    { key: 'isActive', header: t('inventory.status'), width: '100px', render: (row: WarehouseType) => <StatusBadge status={row.isActive ? 'active' : 'inactive'} /> },
    { key: 'actions', header: '', width: '160px', render: (row: WarehouseType) => (
      <ActionButtons
        onView={() => handleViewStock(row)}
        onEdit={() => handleOpenEdit(row)}
        onDelete={() => setConfirmDelete(row.id)}
        showPrint={false}
        showExport={false}
      />
    )},
  ], [t, handleOpenEdit, handleViewStock]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Warehouse size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('inventory.warehouses')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('inventory.page.subtitle')}</p>
          </div>
        </div>
        <Can action="create" module="inventory">
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={handleOpenCreate}>
            {t('inventory.newWarehouse')}
          </Button>
        </Can>
      </div>

      <Card>
        {warehouses.length === 0 && !isLoading ? (
          <EmptyState
            icon="inbox"
            title={t('inventory.empty.warehouses.title')}
            description={t('inventory.empty.warehouses.description')}
            action={<Can action="create" module="inventory"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={handleOpenCreate}>{t('inventory.newWarehouse')}</Button></Can>}
          />
        ) : (
          <Table<WarehouseType>
            data={warehouses}
            columns={columns}
            keyExtractor={(row) => row.id}
            isLoading={isLoading}
            emptyMessage=""
          />
        )}
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingId ? t('inventory.editWarehouse') || 'تعديل المستودع' : t('inventory.newWarehouse')}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? t('common.loading') : t('save')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label={t('inventory.warehouse')} value={formData.name} onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))} required />
          <Input label={t('inventory.productCode')} value={formData.code} onChange={e => setFormData(prev => ({ ...prev, code: e.target.value }))} />
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('inventory.branch')}</label>
            <BranchSelect
              companyId={activeCompany?.id || ''}
              value={formData.branchId}
              onChange={v => setFormData(prev => ({ ...prev, branchId: v || '' }))}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.isActive}
              onChange={e => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
              className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-slate-700 dark:text-slate-200">{t('inventory.active')}</span>
          </label>
        </div>
      </Modal>

      {/* Stock by Warehouse Modal */}
      <Modal
        isOpen={isStockModalOpen}
        onClose={() => setIsStockModalOpen(false)}
        title={`${t('inventory.stockByWarehouse')} - ${selectedWarehouse?.name || ''}`}
        size="lg"
        footer={<Button variant="secondary" onClick={() => setIsStockModalOpen(false)}>{t('close')}</Button>}
      >
        {warehouseStock.length === 0 ? (
          <EmptyState icon="inbox" title={t('inventory.empty.stock.title')} description={t('inventory.empty.warehouseProducts.description')} />
        ) : (
          <div className="space-y-4">
            <div className="bg-primary-50 dark:bg-primary-900/20 p-3 rounded-lg flex items-center justify-between">
              <span className="text-sm text-slate-600 dark:text-slate-300">{t('inventory.stockValue')}:</span>
              <span className="text-lg font-bold text-primary-600 dark:text-primary-400">{formatCurrency(warehouseStockValue)}</span>
            </div>
            <Table
              data={warehouseStock}
              columns={[
                { key: 'productCode', header: t('inventory.productCode'), render: (row: StockItem) => <span className="font-mono text-xs">{row.productCode || '-'}</span> },
                { key: 'productName', header: t('inventory.productName') },
                { key: 'quantity', header: t('inventory.quantity'), align: 'right' as const, render: (row: StockItem) => <span className="font-semibold">{row.quantity}</span> },
                { key: 'unit', header: t('inventory.unitPrice'), width: '100px' },
              ]}
              keyExtractor={(row) => row.id}
            />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        title={t('delete')}
        message={t('inventory.deleteConfirm')}
        variant="danger"
      />
    </div>
  );
};

export default WarehousesPage;
