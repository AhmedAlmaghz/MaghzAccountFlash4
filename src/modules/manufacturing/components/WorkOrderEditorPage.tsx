import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, Play, CheckCircle2, XCircle } from 'lucide-react';
import { Card, Button, Input } from '@/core/ui/components';
import { DocumentPageShell, DocumentItemsGrid, TotalsPanel, useDocumentEditorGuard, useRestoreDraft, UnsavedChangesDialog, type DocumentLine } from '@/core/ui/components/document';
import { ProductSelect, WarehouseSelect } from '@/core/ui/components/smart';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useFormatters } from '@/core/utils/useFormatters';
import { todayIso } from '@/core/utils/aging';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { manufacturingApi } from '../api';
import type { ProductionCostCategory } from '../types';

const emptyLine: DocumentLine = {
  productId: '',
  productName: '',
  quantity: 1,
  unitPrice: 0,
  unitFactor: 1,
};

const costCategories: ProductionCostCategory[] = ['labor', 'energy', 'packaging', 'other'];

export const WorkOrderEditorPage: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((s) => s.activeCompany);
  const user = useAuthStore((s) => s.user);
  const companyId = activeCompany?.id || '';
  const { getNextNumber } = useDocumentSequence();
  const { formatCurrency } = useFormatters(companyId);

  const isEdit = Boolean(id);
  const [productId, setProductId] = useState('');
  const [productName, setProductName] = useState('');
  const [bomId, setBomId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [batchNumber, setBatchNumber] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState(todayIso());
  const [plannedEndDate, setPlannedEndDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DocumentLine[]>([emptyLine]);
  const [productionCosts, setProductionCosts] = useState<Record<ProductionCostCategory, string>>({ labor: '0', energy: '0', packaging: '0', other: '0' });
  const [status, setStatus] = useState<string>('planned');
  const [docNumber, setDocNumber] = useState('');
  const [outputWarehouseId, setOutputWarehouseId] = useState('');
  const [producedQuantity, setProducedQuantity] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const { blocked, proceed, reset, guardNavigate, clearDraft, isDirty } = useDocumentEditorGuard('work-order', { productId, quantity, batchNumber, plannedStartDate, plannedEndDate, notes, lines, productionCosts }, loading, isEdit, saving);
  const draftSetters = useMemo(() => ({ productId: setProductId, quantity: setQuantity, batchNumber: setBatchNumber, plannedStartDate: setPlannedStartDate, plannedEndDate: setPlannedEndDate, notes: setNotes, lines: setLines }), []);
  useRestoreDraft('work-order', isEdit, draftSetters);

  // Reserve the order number: the create* schema requires it and the API
  // never generates one — a missing number fails validation and the save
  // silently does nothing.
  useEffect(() => {
    if (isEdit || !companyId) return;
    let cancelled = false;
    (async () => {
      const seq = await getNextNumber('work_order', companyId);
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
      const res = await manufacturingApi.getWorkOrderById(id, companyId);
      if (cancelled) return;
      setLoading(false);
      if (res?.success && res.data) {
        const wo = res.data.workOrder;
        setProductId(wo.productId ?? '');
        setProductName(wo.productName ?? '');
        setBomId(wo.bomId ?? '');
        setQuantity(wo.quantity ?? 1);
        setBatchNumber(wo.batchNumber ?? '');
        setPlannedStartDate(wo.plannedStartDate ?? todayIso());
        setPlannedEndDate(wo.plannedEndDate ?? todayIso());
        setNotes(wo.notes ?? '');
        setStatus(wo.status ?? 'planned');
        setDocNumber(wo.orderNumber ?? '');
        setOutputWarehouseId(wo.outputWarehouseId ?? '');
        setLines((res.data.lines ?? []).map((l) => ({
          productId: l.materialId ?? '',
          productName: l.materialName ?? '',
          quantity: l.plannedQuantity ?? 1,
          unitPrice: l.unitCost ?? 0,
          unitFactor: 1,
        })));
        if (wo.productionCosts) {
          for (const pc of wo.productionCosts) {
            setProductionCosts((prev) => ({ ...prev, [pc.category]: String(pc.amount ?? 0) }));
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, companyId]);

  const totals = useMemo(() => {
    const materials = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    const costs = Object.values(productionCosts).reduce((s, v) => s + (Number(v) || 0), 0);
    return { subtotal: materials, discountAmount: 0, vatAmount: 0, totalAmount: materials + costs, itemsCount: lines.length };
  }, [lines, productionCosts]);

  const save = useCallback(async () => {
    if (!companyId || !productId || lines.length === 0) {
      addToast('error', t('validation.required'));
      return;
    }
    if (plannedEndDate < plannedStartDate) {
      addToast('error', t('manufacturing.workOrders.invalidDates'));
      return;
    }
    setSaving(true);
    const payload = {
      // companyId is REQUIRED by the create* schema — the API validates the
      // payload exactly as it arrives and never injects the tenant, so a
      // missing companyId fails validation and the save silently does
      // nothing (no request, no error the user can act on).
      companyId,
      orderNumber: docNumber,
      productId,
      bomId: bomId || undefined,
      quantity: quantity || 1,
      batchNumber: batchNumber || undefined,
      plannedStartDate: plannedStartDate || undefined,
      plannedEndDate: plannedEndDate || undefined,
      notes: notes || undefined,
      productionCosts: costCategories.filter((c) => (Number(productionCosts[c]) || 0) > 0).map((c) => ({ category: c, amount: Number(productionCosts[c]) || 0 })),
      lines: lines.map((l) => ({
        materialId: l.productId,
        plannedQuantity: l.quantity,
        unitCost: l.unitPrice,
        actualQuantity: l.quantity,
        actualUnitCost: l.unitPrice,
      })),
    };
    const result = isEdit && id
      ? await manufacturingApi.updateWorkOrder(id, companyId, user?.id, payload as never)
      : await manufacturingApi.createWorkOrder(payload as never, user?.id);
    setSaving(false);
    if (result?.success) {
      clearDraft();
      addToast('success', t('common.saved'));
      navigate('/manufacturing/work-orders');
    } else {
      addToast('error', result?.error || t('common.error'));
    }
  }, [companyId, productId, bomId, quantity, batchNumber, plannedStartDate, plannedEndDate, notes, productionCosts, lines, isEdit, id, user?.id, addToast, t, navigate, clearDraft, docNumber]);

  const changeStatus = useCallback(
    async (next: 'in_progress' | 'completed' | 'cancelled') => {
      if (!id || !companyId) return;
      if (next === 'completed' && !outputWarehouseId) {
        addToast('error', t('validation.required'));
        return;
      }
      setSaving(true);
      const result = await manufacturingApi.updateWorkOrderStatus(
        id,
        companyId,
        next,
        user?.id,
        next === 'completed' ? Number(producedQuantity) || undefined : undefined,
        next === 'completed' ? outputWarehouseId || undefined : undefined
      );
      setSaving(false);
      if (result?.success) {
        addToast('success', t('common.saved'));
        setStatus(next);
      } else {
        addToast('error', result?.error || t('common.error'));
      }
    },
    [id, companyId, outputWarehouseId, producedQuantity, user?.id, addToast, t]
  );

  const title = isEdit ? t('manufacturing.workOrders.editWorkOrder') : t('manufacturing.workOrders.newWorkOrder');
  const actions = (
    <>
      <Button variant="secondary" onClick={() => navigate('/manufacturing/work-orders')}>{t('common.cancel')}</Button>
      {isEdit && status === 'planned' && (
        <Button variant="outline" leftIcon={<Play size={16} />} onClick={() => changeStatus('in_progress')} isLoading={saving}>
          {t('manufacturing.workOrders.start')}
        </Button>
      )}
      {isEdit && status === 'in_progress' && (
        <Button variant="primary" leftIcon={<CheckCircle2 size={16} />} onClick={() => changeStatus('completed')} isLoading={saving}>
          {t('manufacturing.workOrders.complete')}
        </Button>
      )}
      {isEdit && status !== 'completed' && status !== 'cancelled' && (
        <Button variant="ghost" leftIcon={<XCircle size={16} />} onClick={() => changeStatus('cancelled')} isLoading={saving}>
          {t('manufacturing.workOrders.cancel')}
        </Button>
      )}
      <Button variant="primary" leftIcon={<Save size={16} />} onClick={save} isLoading={saving}>{t('common.save')}</Button>
    </>
  );

  if (loading) {
    return <div className="min-h-dvh flex items-center justify-center text-sm text-zinc-500">{t('common.loading')}</div>;
  }

  return (
    <DocumentPageShell
      title={title}
      subtitle={productName}
      onBack={() => guardNavigate(() => navigate('/manufacturing/work-orders'))}
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
      summary={<TotalsPanel totals={totals} formatCurrency={formatCurrency} />}
    >
      <Card className="p-4 sm:p-5 space-y-4">
        <ProductSelect
          companyId={companyId}
          value={productId || undefined}
          onChange={() => undefined}
          onProductChange={(p) => {
            setProductId(p.id);
            setProductName(p.nameAr);
          }}
          manufacturingRole="finished"
          placeholder={t('manufacturing.workOrders.product')}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Input label={t('manufacturing.workOrders.batches')} type="number" value={String(quantity)} onChange={(e) => setQuantity(Number(e.target.value) || 1)} />
          <Input label={t('manufacturing.workOrders.batchNumber')} value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} />
          <Input label={t('common.date')} type="date" value={plannedStartDate} onChange={(e) => setPlannedStartDate(e.target.value)} />
          <Input label={t('common.dueDate')} type="date" value={plannedEndDate} onChange={(e) => setPlannedEndDate(e.target.value)} />
          <Input label={t('common.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} className="sm:col-span-2" />
        </div>
        {isEdit && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-dashed border-zinc-200 dark:border-zinc-800 pt-4">
            <WarehouseSelect companyId={companyId} value={outputWarehouseId || undefined} onChange={(v) => setOutputWarehouseId(v ?? '')} />
            <Input label={t('manufacturing.workOrders.producedQuantity')} type="number" value={producedQuantity} onChange={(e) => setProducedQuantity(e.target.value)} />
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <DocumentItemsGrid companyId={companyId} lines={lines} onChange={setLines} priceType="cost" />
      </Card>

      <Card className="p-4 sm:p-5 space-y-4">
        <h2 className="font-bold">{t('manufacturing.workOrders.productionCosts')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {costCategories.map((c) => (
            <Input key={c} label={t(`manufacturing.productionCosts.${c}`)} type="number" value={productionCosts[c]} onChange={(e) => setProductionCosts((prev) => ({ ...prev, [c]: e.target.value }))} />
          ))}
        </div>
      </Card>
      <UnsavedChangesDialog blocked={blocked} onLeave={proceed} onStay={reset} />
    </DocumentPageShell>
  );
};

export default WorkOrderEditorPage;
