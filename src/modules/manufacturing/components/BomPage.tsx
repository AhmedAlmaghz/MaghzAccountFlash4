import React, { useState, useMemo } from 'react';
import { Eye, GitBranch, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { Card, Button, Input, Modal, Table } from '@/core/ui/components';
import { Pagination } from '@/core/ui/components/Pagination';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { Can } from '@/core/ui/components/PermissionGate';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { ProductSelect } from '@/core/ui/components/smart/fields/ProductSelect';
import { useAppStore } from '@/core/store';
import { useBomsPaginated } from '../hooks/useManufacturing';
import { useDebouncedValue } from '@/core/hooks/useDebouncedValue';
import { manufacturingApi } from '../api';
import { useFormatters } from '@/core/utils/useFormatters';
import { useTranslation } from '@/core/i18n/useTranslation';
import type { BOM, BOMLine } from '../types';

interface BomFormLine {
  materialId: string;
  materialName: string;
  quantity: number;
  unitCost: number;
}

export const BomPage: React.FC = () => {
  const { t } = useTranslation();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearch = useDebouncedValue(searchTerm, 300);
  const filters = useMemo(() => ({ search: debouncedSearch || undefined }), [debouncedSearch]);
  const { items: boms, total, page, pageSize, isLoading, goToPage, changePageSize, create, update, remove } = useBomsPaginated(companyId, filters);
  const { formatCurrency } = useFormatters(companyId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [editing, setEditing] = useState<BOM | null>(null);
  const [viewing, setViewing] = useState<{ bom: BOM; lines: BOMLine[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState({ productId: '', productName: '', version: '1.0', isActive: true, notes: '', totalCost: '' });
  const [lines, setLines] = useState<BomFormLine[]>([{ materialId: '', materialName: '', quantity: 1, unitCost: 0 }]);

  const estimatedTotal = useMemo(() =>
    lines.reduce((sum, l) => sum + (l.quantity * l.unitCost), 0),
  [lines]);

  const resetForm = () => {
    setFormData({ productId: '', productName: '', version: '1.0', isActive: true, notes: '', totalCost: '' });
    setLines([{ materialId: '', materialName: '', quantity: 1, unitCost: 0 }]);
    setEditing(null);
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = async (bom: BOM) => {
    setEditing(bom);
    const res = await manufacturingApi.getBomById(bom.id, companyId);
    if (res.success && res.data) {
      setFormData({
        productId: res.data.bom.productId,
        productName: res.data.bom.productName || bom.productName || '',
        version: res.data.bom.version,
        isActive: res.data.bom.isActive,
        notes: res.data.bom.notes || '',
        totalCost: res.data.bom.totalCost !== undefined ? String(res.data.bom.totalCost) : '',
      });
      setLines(res.data.lines.map((l) => ({
        materialId: l.materialId,
        materialName: l.materialName || l.materialId,
        quantity: l.quantity,
        unitCost: l.unitCost || 0,
      })));
    } else {
      setFormData({
        productId: bom.productId,
        productName: bom.productName || '',
        version: bom.version,
        isActive: bom.isActive,
        notes: bom.notes || '',
        totalCost: bom.totalCost !== undefined ? String(bom.totalCost) : '',
      });
      setLines([]);
    }
    setIsModalOpen(true);
  };

  const openView = async (bom: BOM) => {
    const res = await manufacturingApi.getBomById(bom.id, companyId);
    if (res.success && res.data) {
      setViewing(res.data);
      setIsDetailOpen(true);
    }
  };

  const handleSave = async () => {
    if (!formData.productId || lines.length === 0 || lines.some((l) => !l.materialId)) return;
    const totalCost = formData.totalCost ? Number(formData.totalCost) : estimatedTotal;
    const payload = {
      companyId,
      productId: formData.productId,
      version: formData.version,
      isActive: formData.isActive,
      totalCost,
      notes: formData.notes || undefined,
      lines: lines.map((l) => ({ materialId: l.materialId, quantity: l.quantity, unitCost: l.unitCost })),
    };
    if (editing) {
      await update(editing.id, payload);
    } else {
      await create(payload);
    }
    setIsModalOpen(false);
    resetForm();
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    await remove(confirmDelete);
    setConfirmDelete(null);
  };

  const handlePrint = () => {
    if (!viewing) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const html = generateBomPrintHtml(viewing.bom, viewing.lines, formatCurrency, t);
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  };

  const addLine = () => setLines((prev) => [...prev, { materialId: '', materialName: '', quantity: 1, unitCost: 0 }]);
  const updateLine = (index: number, field: keyof BomFormLine, value: string | number) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };
  const removeLine = (index: number) => setLines((prev) => prev.filter((_, i) => i !== index));

  const columns = [
    { key: 'productName', header: t('manufacturing.table.product') },
    { key: 'version', header: t('manufacturing.table.version'), width: '100px' },
    { key: 'lines', header: t('manufacturing.table.materials'), width: '100px', render: (_row: BOM) => _row.linesCount !== undefined ? `${_row.linesCount} ${t('manufacturing.bom.material')}` : '—' },
    { key: 'totalCost', header: t('manufacturing.table.cost'), align: 'right' as const, render: (row: BOM) => row.totalCost !== undefined ? formatCurrency(row.totalCost) : '—' },
    { key: 'isActive', header: t('manufacturing.table.status'), width: '100px', render: (row: BOM) => <StatusBadge status={row.isActive ? 'active' : 'inactive'} /> },
    { key: 'actions', header: '', width: '140px', render: (row: BOM) => (
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" onClick={() => openView(row)} title={t('settings.common.view')} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20">
          <Eye size={14} />
        </Button>
        <Can action="edit" module="manufacturing">
          <Button size="sm" variant="ghost" onClick={() => openEdit(row)} title={t('settings.common.edit')} className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20">
            <Pencil size={14} />
          </Button>
        </Can>
        <Can action="delete" module="manufacturing">
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(row.id)} title={t('settings.common.delete')} className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20">
            <Trash2 size={14} />
          </Button>
        </Can>
      </div>
    )},
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <GitBranch size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('manufacturing.bom.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('manufacturing.bom.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('manufacturing.bom.searchPlaceholder')}
              aria-label={t('manufacturing.bom.searchPlaceholder')}
              title={t('manufacturing.bom.searchPlaceholder')}
              className="w-56 pl-9 pr-3 py-2 text-sm border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
          </div>
          <Can action="create" module="manufacturing">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>
              {t('manufacturing.bom.newBom')}
            </Button>
          </Can>
        </div>
      </div>

      <Card>
        {isLoading ? (
          <div className="py-12 text-center text-slate-500">{t('settings.common.loading')}</div>
        ) : boms.length === 0 ? (
          <EmptyState icon="file" title={t('manufacturing.bom.emptyTitle')} description={t('manufacturing.bom.emptyDescription')} action={
            <Can action="create" module="manufacturing">
              <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>{t('manufacturing.bom.newBom')}</Button>
            </Can>
          } />
        ) : (
          <>
            <Table<BOM>
              data={boms}
              columns={columns}
              keyExtractor={(row) => row.id}
              emptyMessage={t('manufacturing.bom.emptyTitle')}
            />
            <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
          </>
        )}
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); resetForm(); }}
        title={editing ? t('manufacturing.bom.editBom') : t('manufacturing.bom.newBom')}
        size="3xl"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); resetForm(); }}>{t('settings.common.cancel')}</Button>
            <Button variant="primary" onClick={handleSave}>{t('settings.common.save')}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('manufacturing.form.finishedProduct')}</label>
              <ProductSelect companyId={companyId} value={formData.productId} onChange={(v) => setFormData((prev) => ({ ...prev, productId: typeof v === 'string' ? v : '' }))} showBarcode showStock placeholder={t('manufacturing.form.selectFinishedProduct')} />
            </div>
            <Input label={t('manufacturing.form.version')} value={formData.version} onChange={(e) => setFormData((prev) => ({ ...prev, version: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t('manufacturing.form.totalCost')}
              type="number"
              value={formData.totalCost}
              onChange={(e) => setFormData((prev) => ({ ...prev, totalCost: e.target.value }))}
              placeholder={String(estimatedTotal)}
              helperText={t('manufacturing.form.autoCalculatedCost') + ': ' + formatCurrency(estimatedTotal)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" id="isActive" checked={formData.isActive} onChange={(e) => setFormData((prev) => ({ ...prev, isActive: e.target.checked }))} className="rounded" />
              <label htmlFor="isActive" className="text-sm text-slate-700 dark:text-slate-200">{t('settings.common.active')}</label>
            </div>
            <Input label={t('manufacturing.form.notes')} value={formData.notes} onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))} placeholder={t('manufacturing.form.notesPlaceholder')} />
          </div>

          <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">{t('manufacturing.bom.materials')}</h4>
            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-4">
                    <ProductSelect companyId={companyId} value={line.materialId} onChange={(v) => updateLine(idx, 'materialId', typeof v === 'string' ? v : '')} showBarcode showStock placeholder={idx === 0 ? t('manufacturing.bom.selectMaterial') : ''} />
                  </div>
                  <div className="col-span-3">
                    <Input label={idx === 0 ? t('manufacturing.bom.materialName') : ''} value={line.materialName} onChange={(e) => updateLine(idx, 'materialName', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <Input label={idx === 0 ? t('manufacturing.bom.quantity') : ''} type="number" value={String(line.quantity)} onChange={(e) => updateLine(idx, 'quantity', Number(e.target.value))} />
                  </div>
                  <div className="col-span-2">
                    <Input label={idx === 0 ? t('manufacturing.bom.unitCost') : ''} type="number" value={String(line.unitCost)} onChange={(e) => updateLine(idx, 'unitCost', Number(e.target.value))} />
                  </div>
                  {lines.length > 1 && (
                    <div className="col-span-1">
                      <Button variant="ghost" size="sm" onClick={() => removeLine(idx)} className="text-rose-600">
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Button variant="secondary" className="mt-3" onClick={addLine}>+ {t('manufacturing.actions.addMaterial')}</Button>
            <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between">
              <span className="font-semibold text-slate-700 dark:text-slate-200">{t('manufacturing.bom.estimatedCost')}:</span>
              <span className="font-bold text-primary-600 tabular-nums">{formatCurrency(estimatedTotal)}</span>
            </div>
          </div>
        </div>
      </Modal>

      {/* View/Print Modal */}
      <Modal
        isOpen={isDetailOpen}
        onClose={() => { setIsDetailOpen(false); setViewing(null); }}
        title={t('manufacturing.bom.details')}
        size="lg"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => { setIsDetailOpen(false); setViewing(null); }}>{t('settings.common.close')}</Button>
            <Button variant="primary" leftIcon={<Printer size={16} />} onClick={handlePrint}>{t('settings.common.print')}</Button>
          </div>
        }
      >
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3">
                <span className="text-slate-500">{t('manufacturing.form.product')}:</span>
                <p className="font-semibold text-slate-900 dark:text-slate-50">{viewing.bom.productName || viewing.bom.productId}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3">
                <span className="text-slate-500">{t('manufacturing.form.version')}:</span>
                <p className="font-semibold text-slate-900 dark:text-slate-50">{viewing.bom.version}</p>
              </div>
            </div>
            <Table<BOMLine>
              data={viewing.lines}
              columns={[
                { key: 'materialName', header: t('manufacturing.bom.materialName') },
                { key: 'quantity', header: t('manufacturing.bom.quantity'), width: '100px' },
                { key: 'unitCost', header: t('manufacturing.bom.unitCost'), align: 'right' as const, render: (row) => formatCurrency(row.unitCost || 0) },
                { key: 'totalCost', header: t('manufacturing.bom.total'), align: 'right' as const, render: (row) => formatCurrency((row.quantity || 0) * (row.unitCost || 0)) },
              ]}
              keyExtractor={(row) => row.id}
            />
            <div className="flex justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
              <span className="font-bold text-slate-700 dark:text-slate-200">{t('manufacturing.bom.totalCost')}:</span>
              <span className="font-bold text-primary-600">{viewing.bom.totalCost !== undefined ? formatCurrency(viewing.bom.totalCost) : formatCurrency(estimatedTotal)}</span>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={t('manufacturing.bom.deleteTitle')}
        message={t('manufacturing.bom.deleteMessage')}
        variant="danger"
      />
    </div>
  );
};

function generateBomPrintHtml(bom: BOM, lines: BOMLine[], formatCurrency: (value: number | string) => string, t: (key: string) => string): string {
  const rows = lines.map((l, i) => `
    <tr>
      <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${i + 1}</td>
      <td style="padding:8px;border:1px solid #e2e8f0">${l.materialName || l.materialId}</td>
      <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${l.quantity}</td>
      <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${formatCurrency(l.unitCost || 0)}</td>
      <td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${formatCurrency((l.quantity || 0) * (l.unitCost || 0))}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>BOM - ${bom.productName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
  <style>body{font-family:'Cairo',sans-serif;background:#f8fafc;padding:24px}.page{max-width:210mm;margin:0 auto;background:white;padding:32px;box-shadow:0 4px 6px rgba(0,0,0,0.1);border-radius:8px}h2{color:#1e40af;border-bottom:2px solid #1e40af;padding-bottom:8px}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:16px}th{background:#1e40af;color:white;padding:10px;border:1px solid #1e40af}td{border:1px solid #e2e8f0}.total{font-weight:700;color:#1e40af;font-size:16px;text-align:left;margin-top:12px}</style></head><body>
  <div class="page"><h2>${t('manufacturing.bom.title')} (BOM)</h2>
  <p><strong>${t('manufacturing.form.product')}:</strong> ${bom.productName || bom.productId}</p>
  <p><strong>${t('manufacturing.form.version')}:</strong> ${bom.version}</p>
  <table><thead><tr><th>#</th><th>${t('manufacturing.bom.materialName')}</th><th>${t('manufacturing.bom.quantity')}</th><th>${t('manufacturing.bom.unitCost')}</th><th>${t('manufacturing.bom.total')}</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="total">${t('manufacturing.bom.totalCost')}: ${bom.totalCost !== undefined ? formatCurrency(bom.totalCost) : '—'} ${t('common.currencyYer')}</div>
  <div style="margin-top:32px;text-align:center;font-size:12px;color:#94a3b8">${t('common.printFooter')}</div>
  </div></body></html>`;
}

export default BomPage;
