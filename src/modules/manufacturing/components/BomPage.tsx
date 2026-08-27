import React, { useState, useMemo } from 'react';
import { Eye, GitBranch, Pencil, Plus, Printer, Search, Trash2, Layers, CheckSquare, XCircle, Wallet, Calculator, Factory } from 'lucide-react';
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
import { getNextDocumentNumber } from '@/core/api';
import { useFormatters } from '@/core/utils/useFormatters';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
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
  const addToast = useToastStore((s) => s.addToast);

  // ── Smart availability calculator ────────────────────────────────────
  const [calcQty, setCalcQty] = useState('1');
  const [availability, setAvailability] = useState<Awaited<ReturnType<typeof manufacturingApi.getBomAvailability>>['data'] | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  const runAvailability = async () => {
    if (!viewing) return;
    setIsCalculating(true);
    const res = await manufacturingApi.getBomAvailability(companyId, viewing.bom.id, Number(calcQty) || 0);
    setIsCalculating(false);
    if (res.success && res.data) setAvailability(res.data);
    else addToast('error', res.error || t('manufacturing.bom.availabilityError'));
  };

  // ── One-click work order from BOM ────────────────────────────────────
  const [isCreatingWo, setIsCreatingWo] = useState(false);
  const createWorkOrderFromBom = async () => {
    if (!viewing) return;
    setIsCreatingWo(true);
    try {
      const seq = await getNextDocumentNumber(companyId, 'work_order');
      if (!seq.success || !seq.number) {
        addToast('error', seq.error || t('manufacturing.wo.seqFailed'));
        return;
      }
      // Work-order quantity = number of BOM batches; consumption lines must
      // carry the TOTAL planned quantity (per-batch qty × batches).
      const batches = Math.max(1, Number(calcQty) || 1);
      const lines = viewing.lines.map((l) => ({
        materialId: l.materialId,
        plannedQuantity: Math.round(l.quantity * batches * 10000) / 10000,
        unitCost: l.unitCost || 0,
      }));
      const res = await manufacturingApi.createWorkOrder({
        companyId,
        orderNumber: seq.number,
        productId: viewing.bom.productId,
        bomId: viewing.bom.id,
        quantity: batches,
        status: 'planned',
        totalCost: viewing.bom.totalCost !== undefined ? Math.round((viewing.bom.totalCost * batches) * 100) / 100 : undefined,
        notes: `${t('manufacturing.wo.fromBom')} v${viewing.bom.version}`,
        lines,
      } as never);
      if (res.success) {
        addToast('success', `${t('manufacturing.wo.createdFromBom')} (${seq.number})`);
        setIsDetailOpen(false);
      } else {
        addToast('error', res.error || t('common.error'));
      }
    } finally {
      setIsCreatingWo(false);
    }
  };

  const [formData, setFormData] = useState({ productId: '', productName: '', version: '1.0', isActive: true, notes: '', totalCost: '', outputQuantity: '1' });
  const [lines, setLines] = useState<BomFormLine[]>([{ materialId: '', materialName: '', quantity: 1, unitCost: 0 }]);

  const estimatedTotal = useMemo(() =>
    lines.reduce((sum, l) => sum + (l.quantity * l.unitCost), 0),
  [lines]);

  const resetForm = () => {
    setFormData({ productId: '', productName: '', version: '1.0', isActive: true, notes: '', totalCost: '', outputQuantity: '1' });
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
        outputQuantity: String(res.data.bom.outputQuantity ?? 1),
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
        outputQuantity: String(bom.outputQuantity ?? 1),
      });
      setLines([]);
    }
    setIsModalOpen(true);
  };

  const openView = async (bom: BOM) => {
    const res = await manufacturingApi.getBomById(bom.id, companyId);
    if (res.success && res.data) {
      setViewing(res.data);
      setAvailability(null);
      setCalcQty('1');
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
      outputQuantity: Math.max(Number(formData.outputQuantity) || 1, 0.0001),
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
    {
      key: 'productName',
      header: t('manufacturing.table.product'),
      render: (row: BOM) => (
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-cyan-600 flex items-center justify-center text-white shrink-0">
            <GitBranch size={14} />
          </div>
          <span className="font-medium truncate">{row.productName || row.productId.slice(0, 8)}</span>
        </div>
      ),
    },
    { key: 'version', header: t('manufacturing.table.version'), width: '100px', render: (row: BOM) => <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border">v{row.version}</span> },
    { key: 'outputQuantity', header: t('manufacturing.form.outputQuantity'), width: '120px', render: (row: BOM) => <span className="tabular-nums font-medium">{row.outputQuantity ?? 1}</span> },
    { key: 'lines', header: t('manufacturing.table.materials'), width: '100px', render: (_row: BOM) => _row.linesCount !== undefined ? `${_row.linesCount} ${t('manufacturing.bom.material')}` : '—' },
    { key: 'totalCost', header: t('manufacturing.table.cost'), align: 'right' as const, render: (row: BOM) => row.totalCost !== undefined ? <span className="font-bold tabular-nums">{formatCurrency(row.totalCost)}</span> : '—' },
    { key: 'isActive', header: t('manufacturing.table.status'), width: '110px', render: (row: BOM) => <StatusBadge status={row.isActive ? 'active' : 'inactive'} /> },
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

  const kpis = useMemo(() => {
    const active = boms.filter((b) => b.isActive).length;
    const inactive = boms.length - active;
    const withCost = boms.filter((b) => b.totalCost !== undefined);
    const avgCost = withCost.length > 0 ? withCost.reduce((s, b) => s + Number(b.totalCost || 0), 0) / withCost.length : 0;
    return { active, inactive, avgCost };
  }, [boms]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Gradient Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-700 via-cyan-600 to-teal-600 shadow-xl shadow-cyan-900/10 dark:shadow-cyan-900/20">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
        <div className="relative px-6 py-10 sm:px-8 sm:py-12 text-white">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-cyan-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
              <Layers size={12} /> {t('manufacturing.bom.title')}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t('manufacturing.bom.title')}</h2>
              <p className="text-cyan-100/80 text-base max-w-lg">{t('manufacturing.bom.subtitle')}</p>
            </div>
            <Can action="create" module="manufacturing">
              <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={openCreate} className="bg-white/10 hover:bg-white/20 text-white border-white/20 shrink-0">{t('manufacturing.bom.newBom')}</Button>
            </Can>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('manufacturing.bom.totalCount'), value: String(total), icon: Layers, color: 'from-cyan-600 to-cyan-700', bg: 'bg-gradient-to-br from-cyan-50 to-cyan-100 dark:from-cyan-900/10 dark:to-cyan-800/5' },
          { label: t('settings.common.active'), value: String(kpis.active), icon: CheckSquare, color: 'from-emerald-600 to-emerald-700', bg: 'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/10 dark:to-emerald-800/5' },
          { label: t('settings.common.inactive'), value: String(kpis.inactive), icon: XCircle, color: 'from-slate-600 to-slate-700', bg: 'bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900/10 dark:to-slate-800/5' },
          { label: t('manufacturing.bom.avgCost'), value: formatCurrency(kpis.avgCost), icon: Wallet, color: 'from-amber-600 to-amber-700', bg: 'bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/10 dark:to-amber-800/5' },
        ].map((k) => (
          <Card key={k.label} className="p-0 overflow-hidden relative">
            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${k.color}`} />
            <div className={`p-4 ${k.bg}`}>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-tight truncate">{k.label}</p>
                  <p className="text-lg md:text-xl font-extrabold tabular-nums leading-tight mt-1 truncate">{k.value}</p>
                </div>
                <div className="p-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm border border-slate-100 dark:border-slate-700 shrink-0">
                  <k.icon size={18} className="text-slate-600 dark:text-slate-300" />
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Toolbar */}
      <Card noPadding className="p-4 sm:p-5 border-t-2 border-cyan-500/30">
        <div className="relative max-w-md">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('manufacturing.bom.searchPlaceholder')}
            aria-label={t('manufacturing.bom.searchPlaceholder')}
            title={t('manufacturing.bom.searchPlaceholder')}
            className="w-full pr-9 pl-3 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-colors"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="مسح"><Trash2 size={13} /></button>
          )}
        </div>
      </Card>

      <Card noPadding>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : boms.length === 0 && !debouncedSearch ? (
          <div className="py-8">
            <EmptyState icon="file" title={t('manufacturing.bom.emptyTitle')} description={t('manufacturing.bom.emptyDescription')} action={
              <Can action="create" module="manufacturing">
                <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>{t('manufacturing.bom.newBom')}</Button>
              </Can>
            } />
          </div>
        ) : boms.length === 0 ? (
          <div className="py-10">
            <EmptyState icon="search" title={t('sales.filter.noResults')} description={t('sales.filter.noResultsDesc')} action={
              <Button variant="secondary" onClick={() => setSearchTerm('')}>{t('sales.filter.clearFilters')}</Button>
            } />
          </div>
        ) : (
          <>
            <Table<BOM>
              data={boms}
              columns={columns}
              keyExtractor={(row) => row.id}
              emptyMessage={t('manufacturing.bom.emptyTitle')}
            />
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={goToPage} onPageSizeChange={changePageSize} />
            </div>
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
              <ProductSelect companyId={companyId} value={formData.productId} onChange={(v) => setFormData((prev) => ({ ...prev, productId: typeof v === 'string' ? v : '' }))} usage="finished" showBarcode showStock placeholder={t('manufacturing.form.selectFinishedProduct')} />
            </div>
            <Input label={t('manufacturing.form.version')} value={formData.version} onChange={(e) => setFormData((prev) => ({ ...prev, version: e.target.value }))} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input
              label={t('manufacturing.form.outputQuantity')}
              type="number"
              value={formData.outputQuantity}
              onChange={(e) => setFormData((prev) => ({ ...prev, outputQuantity: e.target.value }))}
              helperText={t('manufacturing.form.outputQuantityHint')}
            />
            <Input
              label={t('manufacturing.form.totalCost')}
              type="number"
              value={formData.totalCost}
              onChange={(e) => setFormData((prev) => ({ ...prev, totalCost: e.target.value }))}
              placeholder={String(estimatedTotal)}
              helperText={t('manufacturing.form.autoCalculatedCost') + ': ' + formatCurrency(estimatedTotal)}
            />
            <div className="flex items-end pb-1">
              <div className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800 rounded p-2 w-full">
                {t('manufacturing.form.unitCostPerUnit')}: <span className="font-bold tabular-nums">{formatCurrency(estimatedTotal / Math.max(Number(formData.outputQuantity) || 1, 0.0001))}</span>
              </div>
            </div>
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
                    <ProductSelect
                      companyId={companyId}
                      value={line.materialId}
                      onChange={(v) => updateLine(idx, 'materialId', typeof v === 'string' ? v : '')}
                      onProductChange={(product) =>
                        setLines((prev) =>
                          prev.map((l, i) =>
                            i === idx
                              ? {
                                  ...l,
                                  materialId: product.id,
                                  materialName: product.nameAr,
                                  unitCost: l.unitCost ? l.unitCost : Number(product.costPrice) || 0,
                                }
                              : l
                          )
                        )
                      }
                      showBarcode
                      showStock
                      usage="raw"
                      placeholder={idx === 0 ? t('manufacturing.bom.selectMaterial') : ''}
                    />
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
        onClose={() => { setIsDetailOpen(false); setViewing(null); setAvailability(null); }}
        title={t('manufacturing.bom.details')}
        size="lg"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => { setIsDetailOpen(false); setViewing(null); }}>{t('settings.common.close')}</Button>
            <Can action="create" module="manufacturing">
              <Button
                variant="primary"
                leftIcon={isCreatingWo ? undefined : <Factory size={16} />}
                onClick={createWorkOrderFromBom}
                disabled={isCreatingWo || (availability ? !availability.fullyAvailable && availability.lines.length > 0 : false)}
                title={availability && !availability.fullyAvailable ? t('manufacturing.bom.availabilityWarning') : undefined}
              >
                {t('manufacturing.bom.createWo')}
              </Button>
            </Can>
            <Button variant="secondary" leftIcon={<Printer size={16} />} onClick={handlePrint}>{t('settings.common.print')}</Button>
          </div>
        }
      >
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3">
                <span className="text-slate-500">{t('manufacturing.form.product')}:</span>
                <p className="font-semibold text-slate-900 dark:text-slate-50">{viewing.bom.productName || viewing.bom.productId}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3">
                <span className="text-slate-500">{t('manufacturing.form.version')}:</span>
                <p className="font-semibold text-slate-900 dark:text-slate-50">{viewing.bom.version}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3">
                <span className="text-slate-500">{t('manufacturing.form.outputQuantity')}:</span>
                <p className="font-semibold text-slate-900 dark:text-slate-50 tabular-nums">{viewing.bom.outputQuantity ?? 1}</p>
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

            {/* ── Smart availability calculator ─────────────────────── */}
            <div className="rounded-xl border border-cyan-200 dark:border-cyan-800 bg-cyan-50/50 dark:bg-cyan-900/10 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Calculator size={16} className="text-cyan-600" />
                <h4 className="text-sm font-bold text-cyan-800 dark:text-cyan-300">{t('manufacturing.bom.availabilityTitle')}</h4>
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Input
                    label={t('manufacturing.bom.batchesCount')}
                    type="number"
                    min={1}
                    value={calcQty}
                    onChange={(e) => { setCalcQty(e.target.value); setAvailability(null); }}
                    helperText={t('manufacturing.bom.batchesHint')}
                  />
                </div>
                <Button variant="primary" onClick={runAvailability} isLoading={isCalculating} className="shrink-0">
                  {t('manufacturing.bom.checkAvailability')}
                </Button>
              </div>

              {availability && (
                <div className="space-y-2">
                  <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold ${availability.fullyAvailable ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'}`}>
                    <span>{availability.fullyAvailable ? t('manufacturing.bom.fullyAvailable') : t('manufacturing.bom.partiallyAvailable')}</span>
                    {availability.maxBatches !== null && (
                      <span className="tabular-nums">{t('manufacturing.bom.maxBatches')}: {availability.maxBatches} ({availability.maxProducible} {t('manufacturing.bom.unit')})</span>
                    )}
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {availability.lines.map((l) => (
                      <div key={l.materialId} className="flex items-center justify-between text-xs bg-white dark:bg-slate-800 rounded-lg px-3 py-2 border border-slate-100 dark:border-slate-700">
                        <span className="flex items-center gap-2 min-w-0 truncate">
                          {l.sufficient ? <CheckSquare size={13} className="text-emerald-600 shrink-0" /> : <XCircle size={13} className="text-rose-600 shrink-0" />}
                          <span className="truncate font-medium text-slate-700 dark:text-slate-200">{l.materialName || l.materialId.slice(0, 8)}</span>
                        </span>
                        <span className="tabular-nums shrink-0 text-slate-500">
                          {l.required} / <span className={l.sufficient ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-semibold'}>{l.available}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
