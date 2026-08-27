import React, { useState, useMemo } from 'react';
import { Wrench, Plus, Trash2, ArrowRight, FileBarChart, Printer, Layers, ClipboardList, PlayCircle, CheckCircle2, Factory, XCircle, RotateCcw, UserCog } from 'lucide-react';
import { Card, Button, Input, Modal, Table } from '@/core/ui/components';
import { Pagination } from '@/core/ui/components/Pagination';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { ProductSelect } from '@/core/ui/components/smart/fields/ProductSelect';
import { EmployeeSelect } from '@/core/ui/components/smart/fields/EmployeeSelect';
import { WarehouseSelect } from '@/core/ui/components/smart';
import { useToastStore } from '@/core/store/toastStore';
import { useAppStore } from '@/core/store';
import { useWorkOrdersPaginated, useWorkOrderVariance } from '../hooks/useManufacturing';
import { manufacturingApi } from '../api';
import { useFormatters } from '@/core/utils/useFormatters';
import { Can } from '@/core/ui/components/PermissionGate';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import type { WorkOrder, WorkOrderLine } from '../types';

interface WorkOrderFormLine {
  materialId: string;
  plannedQuantity: number;
  unitCost: number;
}

const STATUS_FLOW: WorkOrder['status'][] = ['planned', 'in_progress', 'completed', 'cancelled'];
void STATUS_FLOW;

export const WorkOrdersPage: React.FC = () => {
  const { t } = useTranslation();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const [statusFilter, setStatusFilter] = useState('');
  const filters = useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]);
  const { items: workOrders, total, page, pageSize, isLoading, goToPage, changePageSize, create, update, remove, changeStatus } = useWorkOrdersPaginated(companyId, filters);
  const { formatCurrency } = useFormatters(companyId);
  const { getNextNumber } = useDocumentSequence();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isVarianceOpen, setIsVarianceOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrder | null>(null);
  const [viewing, setViewing] = useState<{ workOrder: WorkOrder; lines: WorkOrderLine[] } | null>(null);
  const [selectedVarianceId, setSelectedVarianceId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<{ id: string; status: WorkOrder['status'] } | null>(null);
const [producedQty, setProducedQty] = useState('');
const [outputWarehouseId, setOutputWarehouseId] = useState('');
const [returnMaterials, setReturnMaterials] = useState(true);
const [isEditingActual, setIsEditingActual] = useState(false);

  const [formData, setFormData] = useState({ orderNumber: '', productId: '', bomId: '', quantity: '1', plannedStartDate: '', plannedEndDate: '', totalCost: '', notes: '', batchNumber: '', supervisorId: '' });
  const [availableBoms, setAvailableBoms] = useState<{ id: string; version: string; totalCost?: number; outputQuantity?: number }[]>([]);
  // Per-batch material quantities of the selected BOM (base, before × batches).
  const [bomBaseLines, setBomBaseLines] = useState<WorkOrderFormLine[] | null>(null);
  const [bomOutputQuantity, setBomOutputQuantity] = useState<number>(1);
  const [lines, setLines] = useState<WorkOrderFormLine[]>([{ materialId: '', plannedQuantity: 1, unitCost: 0 }]);
  // Production costs (labor / energy / packaging / other) — capitalized on completion.
  const [productionCosts, setProductionCosts] = useState<{ category: 'labor' | 'energy' | 'packaging' | 'other'; description: string; amount: string }[]>([
    { category: 'labor', description: '', amount: '' },
    { category: 'energy', description: '', amount: '' },
    { category: 'packaging', description: '', amount: '' },
    { category: 'other', description: '', amount: '' },
  ]);

  const estimatedTotal = useMemo(() =>
    lines.reduce((sum, l) => sum + (l.plannedQuantity * l.unitCost), 0),
  [lines]);

  const productionCostsTotal = useMemo(
    () => productionCosts.reduce((s, c) => s + (Number(c.amount) || 0), 0),
    [productionCosts]
  );

  const batches = Math.max(Number(formData.quantity) || 0, 0);
  const expectedProduction = useMemo(
    () => Math.round(batches * bomOutputQuantity * 10000) / 10000,
    [batches, bomOutputQuantity]
  );

  const resetForm = () => {
    setFormData({ orderNumber: '', productId: '', bomId: '', quantity: '1', plannedStartDate: '', plannedEndDate: '', totalCost: '', notes: '', batchNumber: '', supervisorId: '' });
    setAvailableBoms([]);
    setBomBaseLines(null);
    setBomOutputQuantity(1);
    setLines([{ materialId: '', plannedQuantity: 1, unitCost: 0 }]);
    setProductionCosts([
      { category: 'labor', description: '', amount: '' },
      { category: 'energy', description: '', amount: '' },
      { category: 'packaging', description: '', amount: '' },
      { category: 'other', description: '', amount: '' },
    ]);
    setEditing(null);
  };

  const openCreate = async () => {
    resetForm();
    const seq = await getNextNumber('work_order', companyId);
    setFormData((prev) => ({ ...prev, orderNumber: seq?.number || 'WO-00001' }));
    setIsModalOpen(true);
  };

  const openEdit = async (wo: WorkOrder) => {
    setEditing(wo);
    setFormData({
      orderNumber: wo.orderNumber,
      productId: wo.productId,
      bomId: wo.bomId || '',
      quantity: String(wo.quantity),
      plannedStartDate: wo.plannedStartDate || '',
      plannedEndDate: wo.plannedEndDate || '',
      totalCost: String(wo.totalCost || ''),
      notes: wo.notes || '',
      batchNumber: wo.batchNumber || '',
      supervisorId: wo.supervisorId || '',
    });
    const res = await manufacturingApi.getWorkOrderById(wo.id, companyId);
    if (res.success && res.data) {
      setLines(res.data.lines.map((l) => ({ materialId: l.materialId, plannedQuantity: l.plannedQuantity, unitCost: l.unitCost || 0 })));
      const pcs = res.data.workOrder.productionCosts || [];
      setProductionCosts([
        { category: 'labor', description: pcs.find((c) => c.category === 'labor')?.description || '', amount: pcs.find((c) => c.category === 'labor') ? String(pcs.find((c) => c.category === 'labor')!.amount) : '' },
        { category: 'energy', description: pcs.find((c) => c.category === 'energy')?.description || '', amount: pcs.find((c) => c.category === 'energy') ? String(pcs.find((c) => c.category === 'energy')!.amount) : '' },
        { category: 'packaging', description: pcs.find((c) => c.category === 'packaging')?.description || '', amount: pcs.find((c) => c.category === 'packaging') ? String(pcs.find((c) => c.category === 'packaging')!.amount) : '' },
        { category: 'other', description: pcs.find((c) => c.category === 'other')?.description || '', amount: pcs.find((c) => c.category === 'other') ? String(pcs.find((c) => c.category === 'other')!.amount) : '' },
      ]);
      const bomsRes = await manufacturingApi.getBoms(companyId);
      if (bomsRes.success && bomsRes.data) {
        setAvailableBoms(bomsRes.data.filter((b) => b.productId === wo.productId));
        if (wo.bomId) {
          const selected = bomsRes.data.find((b) => b.id === wo.bomId);
          setBomOutputQuantity(selected?.outputQuantity ?? 1);
        }
      }
    } else {
      setLines([]);
    }
    setIsModalOpen(true);
  };

  const openView = async (wo: WorkOrder) => {
    const res = await manufacturingApi.getWorkOrderById(wo.id, companyId);
    if (res.success && res.data) {
      setViewing(res.data);
      setIsDetailOpen(true);
    }
  };

  const openVariance = (id: string) => {
    setSelectedVarianceId(id);
    setIsVarianceOpen(true);
  };

  const handleSave = async () => {
    if (!formData.orderNumber || !formData.productId) return;
    if (!formData.quantity || Number(formData.quantity) <= 0) return;
    const totalCost = formData.totalCost ? Number(formData.totalCost) : estimatedTotal;
    const pcs = productionCosts
      .filter((c) => Number(c.amount) > 0)
      .map((c) => ({ category: c.category, description: c.description || undefined, amount: Number(c.amount) }));
    const payload = {
      companyId,
      orderNumber: formData.orderNumber,
      productId: formData.productId,
      bomId: formData.bomId || undefined,
      quantity: Number(formData.quantity) || 0,
      status: (editing ? editing.status : 'planned') as WorkOrder['status'],
      plannedStartDate: formData.plannedStartDate || undefined,
      plannedEndDate: formData.plannedEndDate || undefined,
      totalCost: totalCost || undefined,
      batchNumber: formData.batchNumber || undefined,
      supervisorId: formData.supervisorId || undefined,
      productionCosts: pcs,
      notes: formData.notes || undefined,
      lines: lines.map((l) => ({ materialId: l.materialId, plannedQuantity: l.plannedQuantity, unitCost: l.unitCost })),
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

  const handleStatusChange = async () => {
    if (!confirmStatus) return;
    const addToast = useToastStore.getState().addToast;
    const res = await changeStatus(
      confirmStatus.id,
      confirmStatus.status,
      confirmStatus.status === 'completed' && producedQty ? Number(producedQty) : undefined,
      confirmStatus.status === 'completed' && outputWarehouseId ? outputWarehouseId : undefined,
      confirmStatus.status === 'cancelled' ? { returnMaterials } : undefined
    );
    if (res && res.success === false) {
      addToast('error', res.error || t('common.error'));
    } else {
      addToast('success', t('manufacturing.workOrders.statusUpdated'));
    }
    setConfirmStatus(null);
    setProducedQty('');
    setOutputWarehouseId('');
    setReturnMaterials(true);
  };

  // ── Status machine ────────────────────────────────────────────────────
  // Production flow: planned → in_progress → completed.
  // Cancellation is a SEPARATE action available from planned / in_progress.
  // A cancelled order can be reopened back to planned.
  const canAdvance = (status: WorkOrder['status']) => status === 'planned' || status === 'in_progress';

  const nextStatus = (status: WorkOrder['status']): WorkOrder['status'] | undefined =>
    status === 'planned' ? 'in_progress' : status === 'in_progress' ? 'completed' : undefined;

  const canCancel = (status: WorkOrder['status']) => status === 'planned' || status === 'in_progress';

  const statusActionLabel: Record<string, string> = {
    planned: t('manufacturing.status.startExecution'),
    in_progress: t('manufacturing.status.complete'),
    completed: '',
    cancelled: '',
  };

  const columns = [
    {
      key: 'orderNumber',
      header: t('manufacturing.table.orderNumber'),
      width: '135px',
      render: (row: WorkOrder) => (
        <span className="font-mono text-xs font-semibold bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 flex items-center gap-1 w-fit">
          <Wrench size={12} className="text-teal-500" />
          {row.orderNumber}
        </span>
      ),
    },
    {
      key: 'productName',
      header: t('manufacturing.table.product'),
      render: (row: WorkOrder) => (
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 flex items-center justify-center text-white shrink-0">
            <Layers size={14} />
          </div>
          <span className="font-medium truncate">{row.productName || row.productId.slice(0, 8)}</span>
        </div>
      ),
    },
    { key: 'quantity', header: t('manufacturing.table.batches'), width: '90px', render: (row: WorkOrder) => <span className="tabular-nums font-medium">{row.quantity}</span> },
    { key: 'batchNumber', header: t('manufacturing.table.batchNumber'), width: '130px', render: (row: WorkOrder) => row.batchNumber ? <span className="font-mono text-xs bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-300 px-2 py-1 rounded border border-cyan-200 dark:border-cyan-800">{row.batchNumber}</span> : '—' },
    { key: 'supervisorName', header: t('manufacturing.table.supervisor'), width: '130px', render: (row: WorkOrder) => row.supervisorName ? <span className="text-sm text-slate-600 dark:text-slate-300">{row.supervisorName}</span> : '—' },
    { key: 'totalCost', header: t('manufacturing.table.cost'), align: 'right' as const, render: (row: WorkOrder) => row.totalCost !== undefined ? <span className="font-bold tabular-nums">{formatCurrency(row.totalCost)}</span> : '—' },
    { key: 'status', header: t('manufacturing.table.status'), width: '120px', render: (row: WorkOrder) => <StatusBadge status={row.status} /> },
    { key: 'actions', header: '', width: '210px', render: (row: WorkOrder) => (
      <div className="flex items-center gap-1">
        <ActionButtons onView={() => openView(row)} onEdit={() => openEdit(row)} onDelete={() => setConfirmDelete(row.id)} showPrint={false} />
        {canAdvance(row.status) && (
          <Can action="edit" module="manufacturing">
            <Button variant="ghost" size="sm" title={statusActionLabel[row.status]} onClick={() => setConfirmStatus({ id: row.id, status: nextStatus(row.status)! })} className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50">
              <ArrowRight size={14} />
            </Button>
          </Can>
        )}
        {canCancel(row.status) && (
          <Can action="edit" module="manufacturing">
            <Button variant="ghost" size="sm" title={t('manufacturing.status.cancel')} onClick={() => setConfirmStatus({ id: row.id, status: 'cancelled' })} className="text-rose-600 hover:text-rose-700 hover:bg-rose-50">
              <XCircle size={14} />
            </Button>
          </Can>
        )}
        {row.status === 'cancelled' && (
          <Can action="edit" module="manufacturing">
            <Button variant="ghost" size="sm" title={t('manufacturing.status.reopen')} onClick={() => setConfirmStatus({ id: row.id, status: 'planned' })} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50">
              <RotateCcw size={14} />
            </Button>
          </Can>
        )}
        {row.status === 'completed' && (
          <Button variant="ghost" size="sm" title={t('manufacturing.actions.varianceReport')} onClick={() => openVariance(row.id)} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50">
            <FileBarChart size={14} />
          </Button>
        )}
      </div>
    )},
  ];

  const kpis = useMemo(() => ({
    planned: workOrders.filter((w) => w.status === 'planned').length,
    inProgress: workOrders.filter((w) => w.status === 'in_progress').length,
    completed: workOrders.filter((w) => w.status === 'completed').length,
  }), [workOrders]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Gradient Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-700 via-teal-600 to-emerald-600 shadow-xl shadow-teal-900/10 dark:shadow-teal-900/20">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
        <div className="relative px-6 py-10 sm:px-8 sm:py-12 text-white">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-teal-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
              <Layers size={12} /> {t('manufacturing.workOrders.title')}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t('manufacturing.workOrders.title')}</h2>
              <p className="text-teal-100/80 text-base max-w-lg">{t('manufacturing.workOrders.subtitle')}</p>
            </div>
            <Can action="create" module="manufacturing">
              <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={openCreate} className="bg-white/10 hover:bg-white/20 text-white border-white/20 shrink-0">{t('manufacturing.workOrders.newWorkOrder')}</Button>
            </Can>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('manufacturing.workOrders.totalCount'), value: String(total), icon: ClipboardList, color: 'from-teal-600 to-teal-700', bg: 'bg-gradient-to-br from-teal-50 to-teal-100 dark:from-teal-900/10 dark:to-teal-800/5' },
          { label: t('manufacturing.status.planned'), value: String(kpis.planned), icon: PlayCircle, color: 'from-blue-600 to-blue-700', bg: 'bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/10 dark:to-blue-800/5' },
          { label: t('manufacturing.status.inProgress'), value: String(kpis.inProgress), icon: Wrench, color: 'from-amber-600 to-amber-700', bg: 'bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/10 dark:to-amber-800/5' },
          { label: t('manufacturing.status.completed'), value: String(kpis.completed), icon: CheckCircle2, color: 'from-emerald-600 to-emerald-700', bg: 'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/10 dark:to-emerald-800/5' },
        ].map((k) => (
          <Card key={k.label} className="p-0 overflow-hidden relative">
            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${k.color}`} />
            <div className={`p-4 ${k.bg}`}>
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 leading-tight truncate">{k.label}</p>
                  <p className="text-xl md:text-2xl font-extrabold tabular-nums leading-tight mt-1 truncate">{k.value}</p>
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
      <Card noPadding className="p-4 sm:p-5 border-t-2 border-teal-500/30">
        <span className="text-xs text-slate-500 font-medium">{t('manufacturing.workOrders.filterByStatus')}:</span>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {[
            { v: '', l: t('settings.common.all') },
            { v: 'planned', l: t('manufacturing.status.planned') },
            { v: 'in_progress', l: t('manufacturing.status.inProgress') },
            { v: 'completed', l: t('manufacturing.status.completed') },
            { v: 'cancelled', l: t('manufacturing.status.cancelled') },
          ].map((o) => (
            <button
              key={o.v || 'all'}
              onClick={() => setStatusFilter(o.v)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === o.v ? 'bg-teal-600 text-white border-teal-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-teal-300'}`}
            >{o.l}</button>
          ))}
        </div>
      </Card>

      <Card noPadding>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : workOrders.length === 0 && !statusFilter ? (
          <div className="py-8">
            <EmptyState icon="file" title={t('manufacturing.workOrders.emptyTitle')} description={t('manufacturing.workOrders.emptyDescription')} action={
              <Can action="create" module="manufacturing">
                <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>{t('manufacturing.workOrders.newWorkOrder')}</Button>
              </Can>
            } />
          </div>
        ) : workOrders.length === 0 ? (
          <div className="py-10">
            <EmptyState icon="search" title={t('sales.filter.noResults')} description={t('sales.filter.noResultsDesc')} action={
              <Button variant="secondary" onClick={() => setStatusFilter('')}>{t('sales.filter.clearFilters')}</Button>
            } />
          </div>
        ) : (
          <>
            <Table<WorkOrder>
              data={workOrders}
              columns={columns}
              keyExtractor={(row) => row.id}
              emptyMessage={t('manufacturing.workOrders.emptyTitle')}
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
        title={editing ? t('manufacturing.workOrders.editWorkOrder') : t('manufacturing.workOrders.newWorkOrder')}
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
            <Input label={t('manufacturing.workOrders.orderNumber')} value={formData.orderNumber} onChange={(e) => setFormData((prev) => ({ ...prev, orderNumber: e.target.value }))} />
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('manufacturing.form.product')}</label>
              <ProductSelect companyId={companyId} value={formData.productId} onChange={async (v) => {
                const productId = typeof v === 'string' ? v : '';
                setFormData((prev) => ({ ...prev, productId, bomId: '' }));
                if (productId) {
                  const res = await manufacturingApi.getBoms(companyId);
                  if (res.success && res.data) setAvailableBoms(res.data.filter((b) => b.productId === productId));
                  else setAvailableBoms([]);
                } else {
                  setAvailableBoms([]);
                }
              }} placeholder={t('manufacturing.form.selectProduct')} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('manufacturing.form.bom')}</label>
              <select value={formData.bomId} onChange={async (e) => {
                const bomId = e.target.value;
                setFormData((prev) => ({ ...prev, bomId }));
                if (bomId) {
                  const res = await manufacturingApi.getBomById(bomId, companyId);
                  if (res.success && res.data) {
                    const { bom, lines } = res.data;
                    const outQty = Math.max(Number(bom.outputQuantity) || 1, 0.0001);
                    setBomOutputQuantity(outQty);
                    const base = lines.map((l) => ({ materialId: l.materialId, plannedQuantity: Number(l.quantity), unitCost: Number(l.unitCost || 0) }));
                    setBomBaseLines(base);
                    const n = Math.max(Number(formData.quantity) || 1, 1);
                    setLines(base.map((l) => ({ ...l, plannedQuantity: Math.round(l.plannedQuantity * n * 10000) / 10000 })));
                    if (bom.totalCost) {
                      setFormData((prev) => ({ ...prev, totalCost: String(Math.round(bom.totalCost! * n * 100) / 100) }));
                    }
                  }
                } else {
                  setBomBaseLines(null);
                  setBomOutputQuantity(1);
                  setLines([{ materialId: '', plannedQuantity: 1, unitCost: 0 }]);
                }
              }} disabled={availableBoms.length === 0} className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm">
                <option value="">{availableBoms.length === 0 ? t('manufacturing.workOrders.noBom') : t('manufacturing.workOrders.withoutBom')}</option>
                {availableBoms.map((b) => (
                  <option key={b.id} value={b.id}>{t('manufacturing.form.version')} {b.version} ({b.outputQuantity ?? 1} {t('manufacturing.bom.unit')})</option>
                ))}
              </select>
            </div>
            <Input
              label={t('manufacturing.table.batches')}
              type="number"
              min={1}
              value={formData.quantity}
              onChange={(e) => {
                const val = e.target.value;
                setFormData((prev) => ({ ...prev, quantity: val }));
                const n = Math.max(Number(val) || 1, 1);
                if (bomBaseLines) {
                  setLines(bomBaseLines.map((l) => ({ ...l, plannedQuantity: Math.round(l.plannedQuantity * n * 10000) / 10000 })));
                  const bom = availableBoms.find((b) => b.id === formData.bomId);
                  if (bom?.totalCost) setFormData((prev) => ({ ...prev, totalCost: String(Math.round(bom.totalCost! * n * 100) / 100) }));
                }
              }}
              helperText={t('manufacturing.workOrders.batchesHint')}
            />
            <Input label={t('manufacturing.workOrders.totalCost')} type="number" value={formData.totalCost} onChange={(e) => setFormData((prev) => ({ ...prev, totalCost: e.target.value }))} />
          </div>
          {formData.bomId && (
            <div className="rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 px-3 py-2 text-sm text-teal-800 dark:text-teal-300 flex items-center gap-2">
              <Factory size={14} />
              {t('manufacturing.workOrders.expectedProduction')}: <span className="font-bold tabular-nums">{expectedProduction}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('manufacturing.workOrders.plannedStartDate')} type="date" value={formData.plannedStartDate} onChange={(e) => setFormData((prev) => ({ ...prev, plannedStartDate: e.target.value }))} />
            <Input label={t('manufacturing.workOrders.plannedEndDate')} type="date" value={formData.plannedEndDate} onChange={(e) => setFormData((prev) => ({ ...prev, plannedEndDate: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1 flex items-center gap-1"><UserCog size={13} /> {t('manufacturing.workOrders.supervisor')}</label>
              <EmployeeSelect companyId={companyId} value={formData.supervisorId || undefined} onChange={(v) => setFormData((prev) => ({ ...prev, supervisorId: typeof v === 'string' ? v : '' }))} placeholder={t('manufacturing.workOrders.selectSupervisor')} />
            </div>
            <Input
              label={t('manufacturing.table.batchNumber')}
              value={formData.batchNumber}
              onChange={(e) => setFormData((prev) => ({ ...prev, batchNumber: e.target.value }))}
              placeholder={t('manufacturing.workOrders.batchAutoHint')}
              helperText={t('manufacturing.workOrders.batchFormatHint')}
            />
          </div>

          <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">{t('manufacturing.workOrders.productionCosts')}</h4>
            <p className="text-xs text-slate-500 mb-3">{t('manufacturing.workOrders.productionCostsHint')}</p>
            <div className="space-y-2">
              {productionCosts.map((pc, idx) => (
                <div key={pc.category} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-3">
                    <span className="block text-sm font-medium text-slate-600 dark:text-slate-300 pb-2">
                      {pc.category === 'labor' ? t('manufacturing.costs.labor') : pc.category === 'energy' ? t('manufacturing.costs.energy') : pc.category === 'packaging' ? t('manufacturing.costs.packaging') : t('manufacturing.costs.other')}
                    </span>
                  </div>
                  <div className="col-span-6">
                    <Input
                      label={idx === 0 ? t('manufacturing.costs.description') : ''}
                      value={pc.description}
                      onChange={(e) => setProductionCosts((prev) => prev.map((c, i) => i === idx ? { ...c, description: e.target.value } : c))}
                      placeholder={t('manufacturing.costs.descriptionPlaceholder')}
                    />
                  </div>
                  <div className="col-span-3">
                    <Input
                      label={idx === 0 ? t('manufacturing.costs.amount') : ''}
                      type="number"
                      min={0}
                      value={pc.amount}
                      onChange={(e) => setProductionCosts((prev) => prev.map((c, i) => i === idx ? { ...c, amount: e.target.value } : c))}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between">
              <span className="font-semibold text-slate-700 dark:text-slate-200">{t('manufacturing.costs.total')}:</span>
              <span className="font-bold text-amber-600 tabular-nums">{formatCurrency(productionCostsTotal)}</span>
            </div>
          </div>

          <Input label={t('manufacturing.form.notes')} value={formData.notes} onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))} placeholder={t('manufacturing.form.notesPlaceholder')} />

          <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">{t('manufacturing.workOrders.plannedMaterials')}</h4>
            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5">
                    <ProductSelect
                      companyId={companyId}
                      value={line.materialId}
                      onChange={(v) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, materialId: typeof v === 'string' ? v : '' } : l)))}
                      onProductChange={(product) =>
                        setLines((prev) =>
                          prev.map((l, i) =>
                            i === idx ? { ...l, materialId: product.id, unitCost: l.unitCost ? l.unitCost : Number(product.costPrice) || 0 } : l
                          )
                        )
                      }
                      showBarcode
                      showStock
                      placeholder={idx === 0 ? t('manufacturing.bom.selectMaterial') : ''}
                    />
                  </div>
                  <div className="col-span-3">
                    <Input label={idx === 0 ? t('manufacturing.bom.quantity') : ''} type="number" value={String(line.plannedQuantity)} onChange={(e) => setLines((prev) => prev.map((l, i) => i === idx ? { ...l, plannedQuantity: Number(e.target.value) } : l))} />
                  </div>
                  <div className="col-span-3">
                    <Input label={idx === 0 ? t('manufacturing.bom.unitCost') : ''} type="number" value={String(line.unitCost)} onChange={(e) => setLines((prev) => prev.map((l, i) => i === idx ? { ...l, unitCost: Number(e.target.value) } : l))} />
                  </div>
                  {lines.length > 1 && (
                    <div className="col-span-1">
                      <Button variant="ghost" size="sm" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} className="text-rose-600">
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <Button variant="secondary" className="mt-3" onClick={() => setLines((prev) => [...prev, { materialId: '', plannedQuantity: 1, unitCost: 0 }])}>+ {t('manufacturing.actions.addMaterial')}</Button>
            <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between">
              <span className="font-semibold text-slate-700 dark:text-slate-200">{t('manufacturing.workOrders.estimatedCostAuto')}:</span>
              <span className="font-bold text-primary-600 tabular-nums">{formatCurrency(estimatedTotal)}</span>
            </div>
          </div>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal
        isOpen={isDetailOpen}
        onClose={() => { setIsDetailOpen(false); setViewing(null); setIsEditingActual(false); }}
        title={t('manufacturing.workOrders.details')}
        size="lg"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            {(viewing?.workOrder.status === 'in_progress' || viewing?.workOrder.status === 'completed') && (
              <Can action="edit" module="manufacturing">
                <Button variant={isEditingActual ? 'primary' : 'secondary'} onClick={async () => {
                  if (isEditingActual && viewing) {
                    const consumptions = viewing.lines.map(line => ({
                      id: line.id,
                      actualQuantity: Number((document.getElementById(`actual-qty-${line.id}`) as HTMLInputElement)?.value) || 0,
                      actualUnitCost: Number((document.getElementById(`actual-cost-${line.id}`) as HTMLInputElement)?.value) || line.unitCost,
                      unitCost: line.unitCost,
                    }));
                    await manufacturingApi.batchUpdateConsumptions(consumptions, companyId);
                    const res = await manufacturingApi.getWorkOrderById(viewing.workOrder.id, companyId);
                    if (res.success && res.data) setViewing(res.data);
                    setIsEditingActual(false);
                  } else {
                    setIsEditingActual(true);
                  }
                }}>
                  {isEditingActual ? t('manufacturing.workOrders.saveActual') : t('manufacturing.workOrders.recordActual')}
                </Button>
              </Can>
            )}
            <Button variant="secondary" leftIcon={<Printer size={16} />} onClick={() => {
              if (!viewing) return;
              const win = window.open('', '_blank');
              if (!win) return;
              const rows = viewing.lines.map((l, i) => `<tr><td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${i + 1}</td><td style="padding:8px;border:1px solid #e2e8f0">${l.materialName || l.materialId}</td><td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${l.plannedQuantity}</td><td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${l.actualQuantity ?? '—'}</td><td style="padding:8px;border:1px solid #e2e8f0;text-align:center">${formatCurrency(l.unitCost)}</td></tr>`).join('');
              win.document.open();
              win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${t('manufacturing.workOrders.title')} ${viewing.workOrder.orderNumber}</title><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet"><style>body{font-family:'Cairo',sans-serif;background:#f8fafc;padding:24px}.page{max-width:210mm;margin:0 auto;background:white;padding:32px;box-shadow:0 4px 6px rgba(0,0,0,0.1);border-radius:8px}h2{color:#1e40af;border-bottom:2px solid #1e40af;padding-bottom:8px}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:16px}th{background:#1e40af;color:white;padding:10px;border:1px solid #1e40af}</style></head><body><div class="page"><h2>${t('manufacturing.workOrders.title')} #${viewing.workOrder.orderNumber}</h2><p><strong>${t('manufacturing.form.product')}:</strong> ${viewing.workOrder.productName || viewing.workOrder.productId}</p><p><strong>${t('manufacturing.table.status')}:</strong> ${viewing.workOrder.status}</p><p><strong>${t('manufacturing.workOrders.plannedQuantity')}:</strong> ${viewing.workOrder.quantity}</p><table><thead><tr><th>#</th><th>${t('manufacturing.bom.materialName')}</th><th>${t('manufacturing.status.planned')}</th><th>${t('manufacturing.status.actual')}</th><th>${t('manufacturing.bom.unitCost')}</th></tr></thead><tbody>${rows}</tbody></table><div style="margin-top:32px;text-align:center;font-size:12px;color:#94a3b8">${t('common.printFooter')}</div></div></body></html>`);
              win.document.close();
            }}>{t('settings.common.print')}</Button>
            <Button variant="secondary" onClick={() => { setIsDetailOpen(false); setViewing(null); setIsEditingActual(false); }}>{t('settings.common.close')}</Button>
          </div>
        }
      >
        {viewing && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3"><span className="text-slate-500">{t('manufacturing.workOrders.orderNumber')}:</span><p className="font-semibold">{viewing.workOrder.orderNumber}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3"><span className="text-slate-500">{t('manufacturing.form.product')}:</span><p className="font-semibold">{viewing.workOrder.productName || viewing.workOrder.productId}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3"><span className="text-slate-500">{t('manufacturing.table.status')}:</span><p className="font-semibold"><StatusBadge status={viewing.workOrder.status} /></p></div>
            </div>
            {viewing.workOrder.notes && (
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-3 text-sm">
                <span className="text-slate-500">{t('manufacturing.form.notes')}:</span>
                <p className="mt-1 text-slate-700 dark:text-slate-300">{viewing.workOrder.notes}</p>
              </div>
            )}
            <Table<WorkOrderLine>
              data={viewing.lines}
              columns={[
                { key: 'materialName', header: t('manufacturing.bom.materialName') },
                { key: 'plannedQuantity', header: t('manufacturing.status.planned'), width: '100px' },
                {
                  key: 'actualQuantity',
                  header: t('manufacturing.status.actual'),
                  width: '120px',
                  render: (row) => isEditingActual && (viewing.workOrder.status === 'in_progress' || viewing.workOrder.status === 'completed')
                    ? <input id={`actual-qty-${row.id}`} type="number" defaultValue={row.actualQuantity ?? 0} className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-sm" />
                    : row.actualQuantity !== undefined && row.actualQuantity !== null && Number(row.actualQuantity) > 0
                      ? formatCurrency(row.actualQuantity)
                      : '—',
                },
                { key: 'unitCost', header: t('manufacturing.bom.unitCost'), align: 'right' as const, render: (row) => formatCurrency(row.unitCost || 0) },
                {
                  key: 'actualUnitCost',
                  header: t('manufacturing.workOrders.actualUnitCost'),
                  align: 'right' as const,
                  width: '120px',
                  render: (row) => isEditingActual && (viewing.workOrder.status === 'in_progress' || viewing.workOrder.status === 'completed')
                    ? <input id={`actual-cost-${row.id}`} type="number" defaultValue={row.actualUnitCost ?? row.unitCost} className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-sm" />
                    : row.actualUnitCost !== undefined && row.actualUnitCost !== null && Number(row.actualUnitCost) > 0
                      ? formatCurrency(row.actualUnitCost)
                      : '—',
                },
              ]}
              keyExtractor={(row) => row.id}
            />
          </div>
        )}
      </Modal>

      {/* Variance Modal */}
      <Modal
        isOpen={isVarianceOpen}
        onClose={() => { setIsVarianceOpen(false); setSelectedVarianceId(null); }}
        title={t('manufacturing.workOrders.varianceReport')}
        size="lg"
        footer={<Button variant="secondary" onClick={() => { setIsVarianceOpen(false); setSelectedVarianceId(null); }}>{t('settings.common.close')}</Button>}
      >
        {selectedVarianceId && <VarianceTable workOrderId={selectedVarianceId} companyId={companyId} />}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={t('manufacturing.workOrders.deleteTitle')}
        message={t('manufacturing.workOrders.deleteMessage')}
        variant="danger"
      />

      {/* Status Change Modal */}
      <Modal
        isOpen={!!confirmStatus}
        onClose={() => { setConfirmStatus(null); setProducedQty(''); setReturnMaterials(true); }}
        title={confirmStatus?.status === 'cancelled' ? t('manufacturing.status.cancel') : t('manufacturing.workOrders.changeStatus')}
        size="sm"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => { setConfirmStatus(null); setProducedQty(''); setReturnMaterials(true); }}>{t('settings.common.cancel')}</Button>
            <Button variant={confirmStatus?.status === 'cancelled' ? 'danger' : 'primary'} onClick={handleStatusChange}>
              {confirmStatus?.status === 'in_progress' ? t('manufacturing.status.startExecution') : confirmStatus?.status === 'completed' ? t('manufacturing.status.complete') : confirmStatus?.status === 'cancelled' ? t('manufacturing.status.cancel') : t('settings.common.save')}
            </Button>
          </div>
        }
      >
        {confirmStatus && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t('manufacturing.workOrders.changeStatusTo')} <span className="font-semibold">"{statusLabel(confirmStatus.status, t)}"</span>?
            </p>
            {/* START: explain raw-material issuance consequence */}
            {confirmStatus.status === 'in_progress' && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <Factory size={14} className="mt-0.5 shrink-0" />
                <span>{t('manufacturing.wo.startIssuesMaterials')}</span>
              </div>
            )}
            {/* CANCEL: separate action with optional material return */}
            {confirmStatus.status === 'cancelled' && (
              <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 p-3 text-xs text-rose-800 dark:text-rose-300 space-y-2">
                <div className="flex items-start gap-2">
                  <XCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{t('manufacturing.wo.cancelExplanation')}</span>
                </div>
                <label className="flex items-center gap-2 pt-1 cursor-pointer">
                  <input type="checkbox" checked={returnMaterials} onChange={(e) => setReturnMaterials(e.target.checked)} className="rounded" />
                  <span className="font-medium">{t('manufacturing.wo.returnMaterials')}</span>
                </label>
              </div>
            )}
            {/* COMPLETE: produced qty + output warehouse */}
            {confirmStatus.status === 'completed' && (
              <>
                <div>
                  <Input
                    label={t('manufacturing.workOrders.actualProducedQuantity')}
                    type="number"
                    value={producedQty}
                    onChange={(e) => setProducedQty(e.target.value)}
                    placeholder={t('manufacturing.workOrders.enterActualQuantity')}
                    helperText={t('manufacturing.workOrders.producedDefaultHint')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('manufacturing.wo.outputWarehouse')}</label>
                  <WarehouseSelect
                    companyId={activeCompany?.id || ''}
                    value={outputWarehouseId}
                    onChange={(v) => setOutputWarehouseId(typeof v === 'string' ? v : '')}
                  />
                  <p className="text-xs text-slate-500 mt-1">{t('manufacturing.wo.outputWarehouseHint')}</p>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

function VarianceTable({ workOrderId, companyId }: { workOrderId: string; companyId: string }) {
  const { t } = useTranslation();
  const { variances, isLoading } = useWorkOrderVariance(workOrderId, companyId);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  if (isLoading) return <div className="py-8 text-center text-slate-500">{t('settings.common.loading')}</div>;
  if (variances.length === 0) return <EmptyState title={t('manufacturing.variance.emptyTitle')} description={t('manufacturing.variance.emptyDescription')} />;
  return (
    <Table
      data={variances}
      columns={[
        { key: 'materialName', header: t('manufacturing.bom.materialName') },
        { key: 'plannedQty', header: t('manufacturing.status.planned'), width: '90px' },
        { key: 'actualQty', header: t('manufacturing.status.actual'), width: '90px' },
        { key: 'varianceQty', header: t('manufacturing.variance.quantityDifference'), width: '90px', render: (row) => <span className={row.varianceQty > 0 ? 'text-rose-600' : row.varianceQty < 0 ? 'text-emerald-600' : ''}>{formatCurrency(row.varianceQty)}</span> },
        { key: 'plannedCost', header: t('manufacturing.variance.plannedCost'), align: 'right' as const, render: (row) => formatCurrency(row.plannedCost) },
        { key: 'actualCost', header: t('manufacturing.variance.actualCost'), align: 'right' as const, render: (row) => formatCurrency(row.actualCost) },
        { key: 'varianceCost', header: t('manufacturing.variance.costDifference'), align: 'right' as const, render: (row) => <span className={row.varianceCost > 0 ? 'text-rose-600 font-semibold' : row.varianceCost < 0 ? 'text-emerald-600 font-semibold' : ''}>{formatCurrency(row.varianceCost)}</span> },
      ]}
      keyExtractor={(row, i) => `${row.materialName}-${i}`}
    />
  );
}

function statusLabel(status: WorkOrder['status'], t: (key: string) => string): string {
  const labels: Record<string, string> = {
    planned: t('manufacturing.status.planned'),
    in_progress: t('manufacturing.status.inProgress'),
    completed: t('manufacturing.status.completed'),
    cancelled: t('manufacturing.status.cancelled'),
  };
  return labels[status] || status;
}

export default WorkOrdersPage;
