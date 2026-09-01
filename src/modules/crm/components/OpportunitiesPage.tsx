import React, { useState, useMemo, useRef } from 'react';
import { Plus, TrendingUp, MoveHorizontal, Search, Layers, Handshake, Trash2, Lock, FileSpreadsheet } from 'lucide-react';
import { Card, Button, Input, Modal, Table, Pagination } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { DuplicateWarningDialog } from '@/core/ui/components/DuplicateWarningDialog';
import { detectDuplicates } from '@/core/utils/duplicateDetection';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useAppStore } from '@/core/store';
import { useOpportunitiesPaginated, useOpportunityKpis } from '../hooks/useCrm';
import type { Opportunity } from '../types';
import { Can } from '@/core/ui/components/PermissionGate';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useFormatters } from '@/core/utils/useFormatters';
import { crmApi } from '../api';
import { exportToExcel } from '@/core/utils/exportEngine';
import { UserSelect } from '@/core/ui/components/smart/fields/UserSelect';
import { LeadSelect } from '@/core/ui/components/smart/fields/LeadSelect';
import { CustomerSelect } from '@/core/ui/components/smart/fields/CustomerSelect';
import { isValidStageTransition, stageTransitionError } from '../types';

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
  const { formatCurrency, formatDate } = useFormatters(companyId);
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
  const { kpis: oppKpis } = useOpportunityKpis(companyId);

  const [viewMode, setViewMode] = useState<'kanban' | 'list' | 'funnel'>('kanban');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Opportunity | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const [formData, setFormData] = useState({ name: '', value: '', stage: 'new' as Opportunity['stage'], probability: '50', expectedCloseDate: '', assignedTo: '', leadId: '', customerId: '', notes: '' });

  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateInputName, setDuplicateInputName] = useState('');
  const [duplicateExact, setDuplicateExact] = useState<{ name: string; code?: string } | null>(null);
  const [duplicateNear, setDuplicateNear] = useState<Array<{ name: string; code?: string; score: number }>>([]);
  const duplicateConfirmedRef = useRef(false);

  const resetForm = () => {
    setFormData({ name: '', value: '', stage: 'new', probability: '50', expectedCloseDate: '', assignedTo: '', leadId: '', customerId: '', notes: '' });
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
      leadId: opp.leadId || '',
      customerId: opp.customerId || '',
      notes: opp.notes || '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name) {
      addToast('error', t('crm.opportunity.name') + ' ' + t('error'));
      return;
    }
    const inputName = formData.name.trim();
    if (!duplicateConfirmedRef.current && inputName) {
      try {
        const allRes = await crmApi.getOpportunities(companyId);
        if (allRes.success && allRes.data) {
          const result = detectDuplicates(inputName, allRes.data as Opportunity[], (o) => o.name, {
            excludeId: editing?.id,
            getId: (o) => o.id,
          });
          if (result.exactMatch) {
            setDuplicateInputName(inputName);
            setDuplicateExact({ name: result.exactMatch.matchedName });
            setDuplicateNear([]);
            setDuplicateOpen(true);
            return;
          }
          if (result.nearMatches.length > 0) {
            setDuplicateInputName(inputName);
            setDuplicateExact(null);
            setDuplicateNear(result.nearMatches.map((m) => ({ name: m.matchedName, score: m.score })));
            setDuplicateOpen(true);
            return;
          }
        }
      } catch {
        /* ignore */
      }
    }
    duplicateConfirmedRef.current = false;
    const payload = {
      companyId,
      name: formData.name,
      value: Number(formData.value) || 0,
      stage: formData.stage,
      probability: Number(formData.probability) || 0,
      expectedCloseDate: formData.expectedCloseDate || undefined,
      assignedTo: formData.assignedTo || undefined,
      leadId: formData.leadId || undefined,
      customerId: formData.customerId || undefined,
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
      if (!isValidStageTransition(opp.stage, stage)) {
        addToast('error', stageTransitionError(opp.stage, stage));
        setDraggedId(null);
        return;
      }
      const res = await update(draggedId, { stage });
      if (res?.success) {
        addToast('success', t('crm.opportunity.updated'));
      } else {
        addToast('error', res?.error || t('error'));
      }
    }
    setDraggedId(null);
  };

  const handleExport = () => {
    const cols = [
      { key: 'name', header: t('crm.opportunity.name') },
      { key: 'value', header: t('crm.opportunity.value') },
      { key: 'stage', header: t('crm.opportunity.stage') },
      { key: 'probability', header: t('crm.opportunity.probability') },
      { key: 'expectedCloseDate', header: t('crm.opportunity.expectedCloseDate') },
      { key: 'assignedName', header: t('crm.opportunity.assignedTo') },
    ];
    const data = opportunities.map((o) => ({
      name: o.name,
      value: o.value,
      stage: t(STAGE_KEYS[o.stage] || o.stage),
      probability: `${o.probability || 0}%`,
      expectedCloseDate: o.expectedCloseDate || '',
      assignedName: (o as unknown as { assignedName?: string }).assignedName || o.assignedTo || '',
    }));
    void exportToExcel(data, cols, `opportunities_${new Date().toISOString().split('T')[0]}`);
  };

  const totalValue = oppKpis?.pipelineValue ?? opportunities.reduce((sum, o) => sum + (o.value || 0), 0);
  const weightedValue = oppKpis?.weightedValue ?? opportunities.reduce((sum, o) => sum + (o.value || 0) * ((o.probability || 0) / 100), 0);
  const displayedCount = oppKpis?.total ?? opportunities.length;

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
    { key: 'expectedCloseDate', header: t('crm.opportunity.expectedCloseDate'), width: '160px', render: (row: Opportunity) => row.expectedCloseDate ? formatDate(row.expectedCloseDate) : '—' },
    {
      key: 'actions',
      header: '',
      width: '160px',
      render: (row: Opportunity) => (
        <div className="flex items-center gap-1">
          <Can action="edit" module="crm">
            <Button variant="ghost" size="sm" className="text-amber-600" onClick={() => openEdit(row)}>{t('settings.common.edit')}</Button>
          </Can>
          <Can action="delete" module="crm">
            <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => setConfirmDelete(row.id)}>{t('settings.common.delete')}</Button>
          </Can>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Gradient Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-fuchsia-700 via-fuchsia-600 to-purple-600 shadow-xl shadow-fuchsia-900/10 dark:shadow-fuchsia-900/20">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
        <div className="relative px-6 py-10 sm:px-8 sm:py-12 text-white">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-fuchsia-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
              <Layers size={12} /> {t('crm.opportunitiesPage.title')}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t('crm.opportunitiesPage.title')}</h2>
              <p className="text-fuchsia-100/80 text-base max-w-lg">{t('crm.opportunitiesPage.description')}</p>
            </div>
            <Can action="create" module="crm"><Button variant="secondary" leftIcon={<Plus size={16} />} onClick={openCreate} className="bg-white/10 hover:bg-white/20 text-white border-white/20 shrink-0">{t('crm.opportunity.new')}</Button></Can>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {[
          { label: t('crm.opportunity.displayed'), value: String(displayedCount), icon: Layers, color: 'from-blue-600 to-blue-700', bg: 'bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/10 dark:to-blue-800/5' },
          { label: t('crm.opportunity.totalValue'), value: formatCurrency(totalValue), icon: Handshake, color: 'from-emerald-600 to-emerald-700', bg: 'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/10 dark:to-emerald-800/5' },
          { label: t('crm.opportunity.weightedValue'), value: formatCurrency(Math.round(weightedValue)), icon: TrendingUp, color: 'from-fuchsia-600 to-fuchsia-700', bg: 'bg-gradient-to-br from-fuchsia-50 to-fuchsia-100 dark:from-fuchsia-900/10 dark:to-fuchsia-800/5' },
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
      <Card noPadding className="p-4 sm:p-5 border-t-2 border-fuchsia-500/30">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
          <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 shrink-0">
            <button onClick={() => setViewMode('kanban')} className={`px-3 py-1 rounded-md text-sm ${viewMode === 'kanban' ? 'bg-white dark:bg-slate-700 shadow-sm' : 'text-slate-500'}`}>{t('crm.viewMode.kanban')}</button>
            <button onClick={() => setViewMode('list')} className={`px-3 py-1 rounded-md text-sm ${viewMode === 'list' ? 'bg-white dark:bg-slate-700 shadow-sm' : 'text-slate-500'}`}>{t('crm.viewMode.list')}</button>
            <button onClick={() => setViewMode('funnel')} className={`px-3 py-1 rounded-md text-sm ${viewMode === 'funnel' ? 'bg-white dark:bg-slate-700 shadow-sm' : 'text-slate-500'}`}>{t('crm.viewMode.funnel')}</button>
          </div>
          <div className="relative flex-1 min-w-0 max-w-md">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder={t('crm.opportunitiesPage.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t('crm.opportunitiesPage.search')}
              className="w-full pr-9 pl-9 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/20 focus:border-fuchsia-500 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="مسح"><Search size={13} /></button>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={handleExport} title={t('export')} aria-label={t('export')}>
            <FileSpreadsheet size={16} className="text-emerald-600" />
          </Button>
          <span className="text-xs text-slate-500 font-medium tabular-nums mr-auto">{total}</span>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 font-medium">{t('crm.opportunity.stageFilter')}:</span>
          <button
            onClick={() => setStageFilter('')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${stageFilter === '' ? 'bg-fuchsia-600 text-white border-fuchsia-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-fuchsia-300'}`}
          >{t('settings.common.all')}</button>
          {STAGES.map((s) => (
            <button
              key={s}
              onClick={() => setStageFilter(s)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${stageFilter === s ? 'bg-fuchsia-600 text-white border-fuchsia-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-fuchsia-300'}`}
            >{t(STAGE_KEYS[s])}</button>
          ))}
        </div>
      </Card>

      {isLoading ? (
        <Card noPadding>
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        </Card>
      ) : opportunities.length === 0 ? (
        <Card noPadding>
          <div className="py-8">
            <EmptyState icon="inbox" title={t('crm.opportunity.empty')} description={t('crm.opportunity.emptyDescription')} action={<Can action="create" module="crm"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>{t('crm.opportunity.new')}</Button></Can>} />
          </div>
        </Card>
      ) : viewMode === 'kanban' ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {STAGES.map((stage) => {
            const isFinal = stage === 'won' || stage === 'lost';
            return (
            <div
              key={stage}
              className={`min-w-[260px] max-w-[320px] flex-1 rounded-lg border ${isFinal ? 'border-slate-300 dark:border-slate-600 ring-1 ring-slate-200 dark:ring-slate-700' : 'border-slate-200 dark:border-slate-700'} ${STAGE_COLORS[stage]}`}
              onDragOver={onDragOver}
              onDrop={() => onDrop(stage)}
            >
              <div className="p-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span className="font-semibold text-sm flex items-center gap-1.5">
                  {isFinal && <Lock size={12} className={stage === 'won' ? 'text-emerald-600' : 'text-rose-600'} />}
                  {t(STAGE_KEYS[stage])}
                </span>
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
                      <p className="font-medium text-sm flex items-center gap-1">
                        {opp.name}
                        {(opp.stage === 'won' || opp.stage === 'lost') && <Lock size={10} className="text-slate-400" />}
                      </p>
                      <p className="text-xs text-slate-500">{opp.probability || 0}%</p>
                    </div>
                    <p className="text-primary-600 font-bold text-sm mb-2">{formatCurrency(opp.value)}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">
                        {opp.closeDate ? (
                          <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">
                            <Lock size={10} /> {formatDate(opp.closeDate)}
                          </span>
                        ) : opp.expectedCloseDate ? formatDate(opp.expectedCloseDate) : '—'}
                      </span>
                      <div className="flex items-center gap-1">
                        <Can action="edit" module="crm">
                          <Button variant="ghost" size="sm" className="text-amber-600 p-1" onClick={() => openEdit(opp)} title={t('settings.common.edit')} aria-label={t('settings.common.edit')}><MoveHorizontal size={12} /></Button>
                        </Can>
                        <Can action="delete" module="crm">
                          <Button variant="ghost" size="sm" className="text-rose-600 p-1" onClick={() => setConfirmDelete(opp.id)} title={t('settings.common.delete')} aria-label={t('settings.common.delete')}><Trash2 size={12} /></Button>
                        </Can>
                      </div>
                    </div>
                  </div>
                ))}
                {opportunities.filter((o) => o.stage === stage).length === 0 && (
                  <div className="text-center text-xs text-slate-400 py-4">{t('crm.opportunity.empty')}</div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      ) : viewMode === 'list' ? (
        <Card>
          <Table<Opportunity>
            data={opportunities}
            columns={listColumns as unknown as never}
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('crm.opportunity.assignedTo')}</label>
              <UserSelect companyId={companyId} value={formData.assignedTo || undefined} onChange={(v) => setFormData((prev) => ({ ...prev, assignedTo: String(v || '') }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">العميل المحتمل</label>
              <LeadSelect companyId={companyId} value={formData.leadId || undefined} onChange={(v) => setFormData((prev) => ({ ...prev, leadId: String(v || '') }))} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">العميل</label>
            <CustomerSelect companyId={companyId} value={formData.customerId || undefined} onChange={(v) => setFormData((prev) => ({ ...prev, customerId: String(v || '') }))} />
          </div>
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

      <DuplicateWarningDialog
        isOpen={duplicateOpen}
        onClose={() => setDuplicateOpen(false)}
        onConfirm={() => {
          duplicateConfirmedRef.current = true;
          setDuplicateOpen(false);
          void handleSave();
        }}
        inputName={duplicateInputName}
        entityLabel={t('crm.opportunity.name')}
        exactMatch={duplicateExact}
        nearMatches={duplicateNear}
        isEdit={!!editing}
      />
    </div>
  );
};

export default OpportunitiesPage;
