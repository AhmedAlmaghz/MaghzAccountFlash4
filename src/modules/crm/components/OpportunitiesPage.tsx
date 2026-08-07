import React, { useState, useMemo } from 'react';
import { CheckSquare, Plus, TrendingUp, BarChart3, MoveHorizontal, Search } from 'lucide-react';
import { Card, Button, Input, Modal, Table, Pagination } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useAppStore } from '@/core/store';
import { useOpportunitiesPaginated } from '../hooks/useCrm';
import type { Opportunity } from '../types';
import { Can } from '@/core/ui/components/PermissionGate';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useFormatters } from '@/core/utils/useFormatters';

const STAGES: Opportunity['stage'][] = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

const STAGE_KEYS: Record<string, string> = {
  new: 'crm.stage.new',
  qualified: 'crm.stage.qualified',
  proposal: 'crm.stage.proposal',
  negotiation: 'crm.stage.negotiation',
  won: 'crm.stage.won',
  lost: 'crm.stage.lost',
};

const STAGE_COLORS: Record<string, string> = {
  new: 'bg-slate-100 dark:bg-slate-800',
  qualified: 'bg-blue-50 dark:bg-blue-900/20',
  proposal: 'bg-purple-50 dark:bg-purple-900/20',
  negotiation: 'bg-amber-50 dark:bg-amber-900/20',
  won: 'bg-emerald-50 dark:bg-emerald-900/20',
  lost: 'bg-rose-50 dark:bg-rose-900/20',
};

export const OpportunitiesPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const { formatCurrency } = useFormatters(companyId);
  const [stageFilter, setStageFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const opportunityFilters = useMemo(
    () => ({
      stage: stageFilter || undefined,
      search: search.trim() || undefined,
    }),
    [stageFilter, search]
  );
  const { opportunities, total, page, pageSize, isLoading, goToPage, changePageSize, create, update, remove } = useOpportunitiesPaginated(companyId, opportunityFilters);

  const [viewMode, setViewMode] = useState<'kanban' | 'list' | 'funnel'>('kanban');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Opportunity | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const [formData, setFormData] = useState({ name: '', value: '', stage: 'new' as Opportunity['stage'], probability: '50', expectedCloseDate: '', assignedTo: '', notes: '' });

  const resetForm = () => {
    setFormData({ name: '', value: '', stage: 'new', probability: '50', expectedCloseDate: '', assignedTo: '', notes: '' });
    setEditing(null);
  };

  const openCreate = () => { resetForm(); setIsModalOpen(true); };
  const openEdit = (opp: Opportunity) => {
    setEditing(opp);
    setFormData({
      name: opp.name,
      value: String(opp.value),
      stage: opp.stage,
      probability: String(opp.probability ?? 50),
      expectedCloseDate: opp.expectedCloseDate || '',
      assignedTo: opp.assignedTo || '',
      notes: opp.notes || '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name) {
      addToast('error', t('crm.opportunity.name') + ' ' + t('error'));
      return;
    }
    const payload = {
      companyId,
      name: formData.name,
      value: Number(formData.value) || 0,
      stage: formData.stage,
      probability: Number(formData.probability) || 0,
      expectedCloseDate: formData.expectedCloseDate || undefined,
      assignedTo: formData.assignedTo || undefined,
      notes: formData.notes || undefined,
    };
    const res = editing ? await update(editing.id, payload) : await create(payload);
    if (res?.success) {
      setIsModalOpen(false);
      resetForm();
      addToast('success', t(editing ? 'crm.opportunity.updated' : 'crm.opportunity.created'));
    } else {
      addToast('error', res?.error || t('error'));
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const res = await remove(confirmDelete);
    if (res?.success) {
      setConfirmDelete(null);
      addToast('success', t('crm.opportunity.deleted'));
    } else {
      addToast('error', res?.error || t('error'));
    }
  };

  const onDragStart = (id: string) => setDraggedId(id);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = async (stage: Opportunity['stage']) => {
    if (!draggedId) return;
    const opp = opportunities.find((o) => o.id === draggedId);
    if (opp && opp.stage !== stage) {
      const res = await update(draggedId, { stage });
      if (res?.success) {
        addToast('success', t('crm.opportunity.updated'));
      } else {
        addToast('error', res?.error || t('error'));
      }
    }
    setDraggedId(null);
  };

  const totalValue = useMemo(() => opportunities.reduce((sum, o) => sum + (o.value || 0), 0), [opportunities]);
  const weightedValue = useMemo(() => opportunities.reduce((sum, o) => sum + (o.value || 0) * ((o.probability || 0) / 100), 0), [opportunities]);

  const funnelData = useMemo(() => {
    return STAGES.map((stage) => {
      const stageOpps = opportunities.filter((o) => o.stage === stage);
      return { stage, label: t(STAGE_KEYS[stage]), count: stageOpps.length, value: stageOpps.reduce((s, o) => s + o.value, 0) };
    });
  }, [opportunities, t]);

  const listColumns = [
    { key: 'name', header: t('crm.opportunity.name') },
    { key: 'value', header: t('crm.opportunity.value'), align: 'right' as const, render: (row: Opportunity) => formatCurrency(row.value) },
    { key: 'stage', header: t('crm.opportunity.stage'), render: (row: Opportunity) => <StatusBadge status={row.stage} /> },
    { key: 'probability', header: t('crm.opportunity.probability'), render: (row: Opportunity) => `${row.probability || 0}%` },
    { key: 'expectedCloseDate', header: t('crm.opportunity.expectedCloseDate'), width: '160px' },
    {
      key: 'actions',
      header: '',
      width: '120px',
      render: (row: Opportunity) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="text-amber-600" onClick={() => openEdit(row)}>{t('settings.common.edit')}</Button>
          <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => setConfirmDelete(row.id)}>{t('settings.common.delete')}</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CheckSquare size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('crm.opportunitiesPage.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('crm.opportunitiesPage.description')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
            <button onClick={() => setViewMode('kanban')} className={`px-3 py-1 rounded-md text-sm ${viewMode === 'kanban' ? 'bg-white dark:bg-slate-700 shadow-sm' : 'text-slate-500'}`}>{t('crm.viewMode.kanban')}</button>
            <button onClick={() => setViewMode('list')} className={`px-3 py-1 rounded-md text-sm ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm' : 'text-slate-500'}`}>{t('crm.viewMode.list')}</button>
            <button onClick={() => setViewMode('funnel')} className={`px-3 py-1 rounded-md text-sm ${viewMode === 'funnel' ? 'bg-white dark:bg-slate-700 shadow-sm' : 'text-slate-500'}`}>{t('crm.viewMode.funnel')}</button>
          </div>
          <Can action="create" module="crm"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>{t('crm.opportunity.new')}</Button></Can>
        </div>
      </div>

      <Card>
        <div className="p-4 flex items-center gap-4 border-b border-slate-200 dark:border-slate-700 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
            <Search size={16} className="text-slate-400" />
            <Input
              placeholder={t('crm.opportunitiesPage.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
              aria-label={t('crm.opportunitiesPage.search')}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-300">{t('crm.opportunity.stageFilter')}:</label>
            <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="px-2 py-1 text-sm border rounded-md dark:bg-slate-900 dark:border-slate-600" aria-label={t('crm.opportunity.stageFilter')}>
              <option value="">{t('settings.common.all')}</option>
              {STAGES.map((s) => (<option key={s} value={s}>{t(STAGE_KEYS[s])}</option>))}
            </select>
          </div>
          <span className="text-xs text-slate-500">{t('crm.total')}: {total}</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
          <div className="card flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center text-white"><TrendingUp size={20} /></div>
            <div><p className="text-2xl font-bold">{opportunities.length}</p><p className="text-sm text-slate-500">{t('crm.opportunity.displayed')}</p></div>
          </div>
          <div className="card flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center text-white"><CheckSquare size={20} /></div>
            <div><p className="text-2xl font-bold">{formatCurrency(totalValue)}</p><p className="text-sm text-slate-500">{t('crm.opportunity.totalValue')}</p></div>
          </div>
          <div className="card flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-500 rounded-lg flex items-center justify-center text-white"><BarChart3 size={20} /></div>
            <div><p className="text-2xl font-bold">{formatCurrency(Math.round(weightedValue))}</p><p className="text-sm text-slate-500">{t('crm.opportunity.weightedValue')}</p></div>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="py-12 text-center text-slate-500">{t('settings.common.loading')}</div>
      ) : opportunities.length === 0 ? (
        <EmptyState icon="inbox" title={t('crm.opportunity.empty')} description={t('crm.opportunity.emptyDescription')} action={<Can action="create" module="crm"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>{t('crm.opportunity.new')}</Button></Can>} />
      ) : viewMode === 'kanban' ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage) => (
            <div
              key={stage}
              className={`min-w-[260px] max-w-[320px] flex-1 rounded-lg border border-slate-200 dark:border-slate-700 ${STAGE_COLORS[stage]}`}
              onDragOver={onDragOver}
              onDrop={() => onDrop(stage)}
            >
              <div className="p-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span className="font-semibold text-sm">{t(STAGE_KEYS[stage])}</span>
                <span className="text-xs bg-white dark:bg-slate-800 px-2 py-0.5 rounded-full">{opportunities.filter((o) => o.stage === stage).length}</span>
              </div>
              <div className="p-3 space-y-3">
                {opportunities.filter((o) => o.stage === stage).map((opp) => (
                  <div
                    key={opp.id}
                    draggable
                    onDragStart={() => onDragStart(opp.id)}
                    className="bg-white dark:bg-slate-900 rounded-md p-3 shadow-sm border border-slate-200 dark:border-slate-700 cursor-move hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-sm">{opp.name}</p>
                      <p className="text-xs text-slate-500">{opp.probability || 0}%</p>
                    </div>
                    <p className="text-primary-600 font-bold text-sm mb-2">{formatCurrency(opp.value)}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">{opp.expectedCloseDate || '—'}</span>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="text-amber-600 p-1" onClick={() => openEdit(opp)} title={t('settings.common.edit')} aria-label={t('settings.common.edit')}><MoveHorizontal size={12} /></Button>
                        <Button variant="ghost" size="sm" className="text-rose-600 p-1" onClick={() => setConfirmDelete(opp.id)} title={t('settings.common.delete')} aria-label={t('settings.common.delete')}><CheckSquare size={12} /></Button>
                      </div>
                    </div>
                  </div>
                ))}
                {opportunities.filter((o) => o.stage === stage).length === 0 && (
                  <div className="text-center text-xs text-slate-400 py-4">{t('crm.opportunity.empty')}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : viewMode === 'list' ? (
        <Card>
          <Table<Opportunity>
            data={opportunities}
            columns={listColumns}
            keyExtractor={(row) => row.id}
            emptyMessage={t('crm.opportunity.empty')}
          />
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={goToPage}
            onPageSizeChange={changePageSize}
          />
        </Card>
      ) : (
        <Card>
          <div className="space-y-4 p-4">
            <h3 className="font-bold text-lg">{t('crm.opportunity.funnelReport')}</h3>
            <div className="space-y-3">
              {funnelData.map((f) => (
                <div key={f.stage} className="flex items-center gap-4">
                  <div className="w-28 text-sm font-medium text-slate-700 dark:text-slate-200">{f.label}</div>
                  <div className="flex-1 h-8 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden relative">
                    <div
                      className="h-full bg-primary-500 rounded-full transition-all duration-500"
                      style={{ width: `${f.count > 0 ? Math.min(100, (f.count / Math.max(1, opportunities.length)) * 100 * STAGES.length) : 0}%` }}
                    />
                    <span className="absolute inset-0 flex items-center px-3 text-xs text-slate-700 dark:text-slate-200">
                      {f.count} {t('crm.opportunity.count')} ({formatCurrency(f.value)})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); resetForm(); }}
        title={editing ? t('crm.opportunity.edit') : t('crm.opportunity.new')}
        size="md"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); resetForm(); }}>{t('settings.common.cancel')}</Button>
            <Button variant="primary" onClick={handleSave}>{t('settings.common.save')}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label={t('crm.opportunity.name')} value={formData.name} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} required />
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('crm.opportunity.value')} type="number" value={formData.value} onChange={(e) => setFormData((prev) => ({ ...prev, value: e.target.value }))} />
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('crm.opportunity.stage')}</label>
              <select value={formData.stage} onChange={(e) => setFormData((prev) => ({ ...prev, stage: e.target.value as Opportunity['stage'] }))} className="form-control">
                {STAGES.map((s) => (<option key={s} value={s}>{t(STAGE_KEYS[s])}</option>))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('crm.opportunity.probability')} type="number" min={0} max={100} value={formData.probability} onChange={(e) => setFormData((prev) => ({ ...prev, probability: e.target.value }))} />
            <Input label={t('crm.opportunity.expectedCloseDate')} type="date" value={formData.expectedCloseDate} onChange={(e) => setFormData((prev) => ({ ...prev, expectedCloseDate: e.target.value }))} />
          </div>
          <Input label={t('crm.opportunity.assignedTo')} value={formData.assignedTo} onChange={(e) => setFormData((prev) => ({ ...prev, assignedTo: e.target.value }))} />
          <Input label={t('crm.form.notes')} value={formData.notes} onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))} />
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={t('crm.opportunity.deleteTitle')}
        message={t('crm.opportunity.deleteMessage')}
        variant="danger"
      />
    </div>
  );
};

export default OpportunitiesPage;
