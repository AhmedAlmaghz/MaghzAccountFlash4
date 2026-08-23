import React, { useState, useMemo } from 'react';
import { Plus, UserCheck, Search, Layers, Flame, ThumbsUp, Handshake } from 'lucide-react';
import { Card, Button, Input, Modal, Table, Pagination } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useAppStore } from '@/core/store';
import { useLeadsPaginated, useActivitiesPaginated } from '../hooks/useCrm';
import type { Lead, Activity } from '../types';
import { Can } from '@/core/ui/components/PermissionGate';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useFormatters } from '@/core/utils/useFormatters';

export const LeadsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const { formatCurrency } = useFormatters(companyId);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const leadFilters = useMemo(
    () => ({
      status: statusFilter || undefined,
      search: search.trim() || undefined,
    }),
    [statusFilter, search]
  );
  const { leads, total, page, pageSize, isLoading, goToPage, changePageSize, create, update, remove, convertToCustomer, reload } = useLeadsPaginated(companyId, leadFilters);
  const { create: createActivity } = useActivitiesPaginated(companyId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isConvertOpen, setIsConvertOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    company: '',
    source: '',
    estimatedValue: '',
    rating: 'warm' as Lead['rating'],
    status: 'new' as Lead['status'],
    assignedTo: '',
    notes: '',
  });
  const [activityForm, setActivityForm] = useState({
    type: 'call' as Activity['type'],
    subject: '',
    description: '',
    activityDate: new Date().toISOString().split('T')[0],
  });

  const resetForm = () => {
    setFormData({ name: '', phone: '', email: '', company: '', source: '', estimatedValue: '', rating: 'warm', status: 'new', assignedTo: '', notes: '' });
    setEditing(null);
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (lead: Lead) => {
    setEditing(lead);
    setFormData({
      name: lead.name,
      phone: lead.phone || '',
      email: lead.email || '',
      company: lead.company || '',
      source: lead.source || '',
      estimatedValue: String(lead.estimatedValue || ''),
      rating: lead.rating,
      status: lead.status,
      assignedTo: lead.assignedTo || '',
      notes: lead.notes || '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name) {
      addToast('error', t('crm.lead.name') + ' ' + t('error'));
      return;
    }
    const payload = {
      companyId,
      name: formData.name,
      phone: formData.phone || undefined,
      email: formData.email || undefined,
      company: formData.company || undefined,
      source: formData.source || undefined,
      status: formData.status,
      rating: formData.rating,
      estimatedValue: Number(formData.estimatedValue) || undefined,
      assignedTo: formData.assignedTo || undefined,
      notes: formData.notes || undefined,
    };
    const res = editing ? await update(editing.id, payload) : await create(payload);
    if (res?.success) {
      setIsModalOpen(false);
      resetForm();
      addToast('success', t(editing ? 'crm.lead.updated' : 'crm.lead.created'));
    } else {
      addToast('error', res?.error || t('error'));
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const res = await remove(confirmDelete);
    if (res?.success) {
      setConfirmDelete(null);
      addToast('success', t('crm.lead.deleted'));
    } else {
      addToast('error', res?.error || t('error'));
    }
  };

  const handleAddActivity = async () => {
    if (!selectedLead) return;
    if (!activityForm.subject) {
      addToast('error', t('crm.activity.subject') + ' ' + t('error'));
      return;
    }
    const res = await createActivity({
      companyId,
      leadId: selectedLead.id,
      type: activityForm.type,
      subject: activityForm.subject,
      description: activityForm.description || undefined,
      activityDate: activityForm.activityDate,
    });
    if (res?.success) {
      setIsActivityOpen(false);
      setSelectedLead(null);
      setActivityForm({ type: 'call', subject: '', description: '', activityDate: new Date().toISOString().split('T')[0] });
      addToast('success', t('crm.activity.created'));
    } else {
      addToast('error', res?.error || t('error'));
    }
  };

  const handleConvert = async () => {
    if (!selectedLead) return;
    const res = await convertToCustomer(selectedLead.id, { address: '', taxNumber: '', creditLimit: 0 });
    if (res?.success) {
      setIsConvertOpen(false);
      setSelectedLead(null);
      addToast('success', t('crm.lead.updated'));
      await reload();
    } else {
      addToast('error', res?.error || t('error'));
    }
  };

  const ratingColor = (rating: Lead['rating']) => {
    if (rating === 'hot') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border border-rose-200 dark:border-rose-800';
    if (rating === 'warm') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-800';
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800';
  };

  const columns = [
    { key: 'name', header: t('crm.lead.name'), render: (row: Lead) => (
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-fuchsia-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
          {(row.name || '?').charAt(0).toUpperCase()}
        </div>
        <span className="font-medium truncate">{row.name}</span>
      </div>
    )},
    { key: 'company', header: t('crm.lead.company') },
    { key: 'phone', header: t('crm.lead.phone'), render: (row: Lead) => <span className="font-mono text-xs tabular-nums">{row.phone || '—'}</span> },
    {
      key: 'rating',
      header: t('crm.lead.rating'),
      render: (row: Lead) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ratingColor(row.rating)}`}>{t(`crm.rating.${row.rating}`)}</span>
      ),
    },
    { key: 'value', header: t('crm.lead.estimatedValue'), align: 'right' as const, render: (row: Lead) => <span className="tabular-nums font-medium">{formatCurrency(row.estimatedValue || 0)}</span> },
    { key: 'status', header: t('crm.lead.status'), render: (row: Lead) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      header: '',
      width: '200px',
      render: (row: Lead) => (
        <div className="flex items-center gap-1">
          <ActionButtons
            onView={() => {
              setSelectedLead(row);
              setIsActivityOpen(true);
            }}
            onEdit={() => openEdit(row)}
            onDelete={() => setConfirmDelete(row.id)}
            showPrint={false}
          />
          {row.status !== 'converted' && row.status !== 'lost' && (
            <Button
              variant="ghost"
              size="sm"
              className="text-emerald-600"
              onClick={() => {
                setSelectedLead(row);
                setIsConvertOpen(true);
              }}
              title={t('crm.lead.convertToCustomer')}
              aria-label={t('crm.lead.convertToCustomer')}
            >
              <UserCheck size={14} />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const kpis = useMemo(() => ({
    newCount: leads.filter((l) => l.status === 'new').length,
    qualified: leads.filter((l) => l.status === 'qualified').length,
    converted: leads.filter((l) => l.status === 'converted').length,
  }), [leads]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Gradient Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-700 via-rose-600 to-fuchsia-600 shadow-xl shadow-rose-900/10 dark:shadow-rose-900/20">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
        <div className="relative px-6 py-10 sm:px-8 sm:py-12 text-white">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-rose-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
              <Layers size={12} /> {t('crm.leadsPage.title')}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t('crm.leadsPage.title')}</h2>
              <p className="text-rose-100/80 text-base max-w-lg">{t('crm.leadsPage.description')}</p>
            </div>
            <Can action="create" module="crm">
              <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={openCreate} className="bg-white/10 hover:bg-white/20 text-white border-white/20 shrink-0">{t('crm.lead.new')}</Button>
            </Can>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('crm.leadsPage.total'), value: String(total), icon: Layers, color: 'from-rose-600 to-rose-700', bg: 'bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-900/10 dark:to-rose-800/5' },
          { label: t('crm.status.new'), value: String(kpis.newCount), icon: Flame, color: 'from-blue-600 to-blue-700', bg: 'bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/10 dark:to-blue-800/5' },
          { label: t('crm.status.qualified'), value: String(kpis.qualified), icon: ThumbsUp, color: 'from-amber-600 to-amber-700', bg: 'bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/10 dark:to-amber-800/5' },
          { label: t('crm.status.converted'), value: String(kpis.converted), icon: Handshake, color: 'from-emerald-600 to-emerald-700', bg: 'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/10 dark:to-emerald-800/5' },
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
      <Card noPadding className="p-4 sm:p-5 border-t-2 border-rose-500/30">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
          <div className="relative flex-1 min-w-0 max-w-md">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder={t('crm.leadsPage.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t('crm.leadsPage.searchLabel')}
              className="w-full pr-9 pl-9 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="مسح"><Search size={13} /></button>
            )}
          </div>
          <span className="text-xs text-slate-500 font-medium tabular-nums mr-auto">{total}</span>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 font-medium">{t('crm.lead.statusFilter')}:</span>
          {[
            { v: '', l: t('settings.common.all') },
            { v: 'new', l: t('crm.status.new') },
            { v: 'contacted', l: t('crm.status.contacted') },
            { v: 'qualified', l: t('crm.status.qualified') },
            { v: 'converted', l: t('crm.status.converted') },
            { v: 'lost', l: t('crm.status.lost') },
          ].map((o) => (
            <button
              key={o.v || 'all'}
              onClick={() => setStatusFilter(o.v)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === o.v ? 'bg-rose-600 text-white border-rose-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-rose-300'}`}
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
        ) : leads.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon="inbox"
              title={t('crm.lead.empty')}
              description={t('crm.lead.emptyDescription')}
              action={
                <Can action="create" module="crm">
                  <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>
                    {t('crm.lead.new')}
                  </Button>
                </Can>
              }
            />
          </div>
        ) : (
          <>
            <Table<Lead>
              data={leads}
              columns={columns}
              keyExtractor={(row) => row.id}
              emptyMessage={t('crm.lead.empty')}
            />
            <div className="border-t border-slate-200 dark:border-slate-800">
              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={goToPage}
                onPageSizeChange={changePageSize}
              />
            </div>
          </>
        )}
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          resetForm();
        }}
        title={editing ? t('crm.lead.edit') : t('crm.lead.new')}
        size="md"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); resetForm(); }}>{t('settings.common.cancel')}</Button>
            <Button variant="primary" onClick={handleSave}>{t('settings.common.save')}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label={t('crm.lead.name')} value={formData.name} onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))} required />
          <Input label={t('crm.lead.company')} value={formData.company} onChange={(e) => setFormData((prev) => ({ ...prev, company: e.target.value }))} />
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('crm.lead.phone')} value={formData.phone} onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))} />
            <Input label={t('crm.lead.email')} type="email" value={formData.email} onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('crm.lead.source')} value={formData.source} onChange={(e) => setFormData((prev) => ({ ...prev, source: e.target.value }))} />
            <Input label={t('crm.lead.estimatedValue')} type="number" value={formData.estimatedValue} onChange={(e) => setFormData((prev) => ({ ...prev, estimatedValue: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('crm.lead.rating')}</label>
              <select value={formData.rating} onChange={(e) => setFormData((prev) => ({ ...prev, rating: e.target.value as Lead['rating'] }))} className="form-control" aria-label={t('crm.lead.rating')}>
                <option value="hot">{t('crm.rating.hot')}</option>
                <option value="warm">{t('crm.rating.warm')}</option>
                <option value="cold">{t('crm.rating.cold')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('crm.lead.status')}</label>
              <select value={formData.status} onChange={(e) => setFormData((prev) => ({ ...prev, status: e.target.value as Lead['status'] }))} className="form-control" aria-label={t('crm.lead.status')}>
                <option value="new">{t('crm.status.new')}</option>
                <option value="contacted">{t('crm.status.contacted')}</option>
                <option value="qualified">{t('crm.status.qualified')}</option>
                <option value="converted">{t('crm.status.converted')}</option>
                <option value="lost">{t('crm.status.lost')}</option>
              </select>
            </div>
          </div>
          <Input label={t('crm.form.assignedTo')} value={formData.assignedTo} onChange={(e) => setFormData((prev) => ({ ...prev, assignedTo: e.target.value }))} />
          <Input label={t('crm.form.notes')} value={formData.notes} onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))} />
        </div>
      </Modal>

      {/* Activity Modal */}
      <Modal
        isOpen={isActivityOpen}
        onClose={() => {
          setIsActivityOpen(false);
          setSelectedLead(null);
        }}
        title={selectedLead ? `${t('crm.lead.followUps')}: ${selectedLead.name}` : t('crm.lead.followUp')}
        size="md"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => { setIsActivityOpen(false); setSelectedLead(null); }}>{t('settings.common.close')}</Button>
            <Button variant="primary" onClick={handleAddActivity}>{t('crm.activity.addActivity')}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('crm.activity.type')}</label>
              <select value={activityForm.type} onChange={(e) => setActivityForm((prev) => ({ ...prev, type: e.target.value as Activity['type'] }))} className="form-control">
                <option value="call">{t('crm.activity.call')}</option>
                <option value="meeting">{t('crm.activity.meeting')}</option>
                <option value="email">{t('crm.activity.email')}</option>
                <option value="visit">{t('crm.activity.visit')}</option>
                <option value="note">{t('crm.activity.note')}</option>
              </select>
            </div>
            <Input label={t('crm.activity.date')} type="date" value={activityForm.activityDate} onChange={(e) => setActivityForm((prev) => ({ ...prev, activityDate: e.target.value }))} />
          </div>
          <Input label={t('crm.activity.subject')} value={activityForm.subject} onChange={(e) => setActivityForm((prev) => ({ ...prev, subject: e.target.value }))} required />
          <Input label={t('crm.activity.details')} value={activityForm.description} onChange={(e) => setActivityForm((prev) => ({ ...prev, description: e.target.value }))} />
          {selectedLead && (
            <div className="text-xs text-slate-500 border-t border-slate-200 dark:border-slate-700 pt-3">
              <span className="font-semibold">{t('crm.lead.name')}:</span> {selectedLead.name} ·{' '}
              <span className="font-semibold">{t('crm.lead.company')}:</span> {selectedLead.company || '—'} ·{' '}
              <span className="font-semibold">{t('crm.form.assignedTo')}:</span> {selectedLead.assignedName || selectedLead.assignedTo || '—'}
            </div>
          )}
        </div>
      </Modal>

      {/* Convert Modal */}
      <ConfirmDialog
        isOpen={isConvertOpen}
        onClose={() => setIsConvertOpen(false)}
        onConfirm={handleConvert}
        title={t('crm.lead.convertTitle')}
        message={t('crm.lead.convertMessage')}
        variant="info"
      />

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={t('crm.lead.deleteTitle')}
        message={t('crm.lead.deleteMessage')}
        variant="danger"
      />
    </div>
  );
};

export default LeadsPage;
