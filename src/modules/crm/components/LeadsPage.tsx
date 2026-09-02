import React, { useState, useMemo, useRef } from 'react';
import { Plus, UserCheck, UserPlus, Layers, Flame, ThumbsUp, Handshake, FileSpreadsheet } from 'lucide-react';
import { Card, Button, Input, Modal, Table, Pagination, PageHeader, StatsGrid, FilterBar } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { DuplicateWarningDialog } from '@/core/ui/components/DuplicateWarningDialog';
import { detectDuplicates } from '@/core/utils/duplicateDetection';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useAppStore } from '@/core/store';
import { useLeadsPaginated, useActivitiesPaginated, useLeadKpis } from '../hooks/useCrm';
import type { Lead, Activity } from '../types';
import { Can } from '@/core/ui/components/PermissionGate';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useFormatters } from '@/core/utils/useFormatters';
import { crmApi } from '../api';
import { exportToExcel } from '@/core/utils/exportEngine';
import { UserSelect } from '@/core/ui/components/smart/fields/UserSelect';

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
  const { kpis: leadKpis, reload: reloadKpis } = useLeadKpis(companyId);

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
  const [convertForm, setConvertForm] = useState({
    address: '',
    taxNumber: '',
    creditLimit: '',
    phone: '',
    email: '',
    createOpportunity: false,
  });

  // duplicate guard
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateInputName, setDuplicateInputName] = useState('');
  const [duplicateExact, setDuplicateExact] = useState<{ name: string; code?: string } | null>(null);
  const [duplicateNear, setDuplicateNear] = useState<Array<{ name: string; code?: string; score: number }>>([]);
  const duplicateConfirmedRef = useRef(false);

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

  const openConvert = (lead: Lead) => {
    setSelectedLead(lead);
    setConvertForm({
      address: '',
      taxNumber: '',
      creditLimit: '',
      phone: lead.phone || '',
      email: lead.email || '',
      createOpportunity: false,
    });
    setIsConvertOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name) {
      addToast('error', t('crm.lead.name') + ' ' + t('error'));
      return;
    }
    const inputName = formData.name.trim();
    if (!duplicateConfirmedRef.current && inputName) {
      try {
        const allRes = await crmApi.getLeads(companyId);
        if (allRes.success && allRes.data) {
          const result = detectDuplicates(inputName, allRes.data as Lead[], (c) => c.name, {
            excludeId: editing?.id,
            getId: (c) => c.id,
            getCode: (c) => c.phone,
          });
          if (result.exactMatch) {
            setDuplicateInputName(inputName);
            setDuplicateExact({ name: result.exactMatch.matchedName, code: result.exactMatch.matchedCode });
            setDuplicateNear([]);
            setDuplicateOpen(true);
            return;
          }
          if (result.nearMatches.length > 0) {
            setDuplicateInputName(inputName);
            setDuplicateExact(null);
            setDuplicateNear(result.nearMatches.map((m) => ({ name: m.matchedName, code: m.matchedCode, score: m.score })));
            setDuplicateOpen(true);
            return;
          }
        }
      } catch {
        /* ignore */
      }
    }
    const wasConfirmed = duplicateConfirmedRef.current;
    duplicateConfirmedRef.current = false;
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
    } as unknown as Omit<Lead, 'id' | 'createdAt'>;
    let res: { success: boolean; error?: string; duplicate?: unknown; opportunityId?: string } | undefined;
    if (editing) {
      res = await update(editing.id, payload);
    } else {
      if (wasConfirmed) {
        res = await crmApi.createLead(payload, undefined, { allowDuplicate: true });
        if (res?.success) await reload();
      } else {
        res = await create(payload);
      }
    }
    if (res?.success) {
      setIsModalOpen(false);
      resetForm();
      addToast('success', t(editing ? 'crm.lead.updated' : 'crm.lead.created'));
      void reloadKpis();
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
      void reloadKpis();
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
    const payload: Record<string, unknown> = {
      address: convertForm.address || undefined,
      taxNumber: convertForm.taxNumber || undefined,
      creditLimit: convertForm.creditLimit ? Number(convertForm.creditLimit) : undefined,
      phone: convertForm.phone || undefined,
      email: convertForm.email || undefined,
      createOpportunity: convertForm.createOpportunity,
    };
    const res = await convertToCustomer(selectedLead.id, payload);
    if (res?.success) {
      setIsConvertOpen(false);
      const msg = (res as { opportunityId?: string }).opportunityId ? `${t('crm.lead.updated')} — ${t('crm.opportunity.created')}` : t('crm.lead.updated');
      addToast('success', msg);
      setSelectedLead(null);
      await reload();
      void reloadKpis();
    } else {
      addToast('error', res?.error || t('error'));
    }
  };

  const handleExport = () => {
    const cols = [
      { key: 'name', header: t('crm.lead.name') },
      { key: 'company', header: t('crm.lead.company') },
      { key: 'phone', header: t('crm.lead.phone') },
      { key: 'email', header: t('crm.lead.email') },
      { key: 'rating', header: t('crm.lead.rating') },
      { key: 'status', header: t('crm.lead.status') },
      { key: 'estimatedValue', header: t('crm.lead.estimatedValue') },
    ];
    const data = leads.map((l) => ({
      name: l.name,
      company: l.company || '',
      phone: l.phone || '',
      email: l.email || '',
      rating: t(`crm.rating.${l.rating}`),
      status: t(`crm.status.${l.status}`),
      estimatedValue: l.estimatedValue || 0,
    }));
    void exportToExcel(data, cols, `leads_${new Date().toISOString().split('T')[0]}`);
  };

  const ratingColor = (rating: Lead['rating']) => {
    if (rating === 'hot') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border border-rose-200 dark:border-rose-800';
    if (rating === 'warm') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border border-amber-200 dark:border-amber-800';
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-200 dark:border-blue-800';
  };

  const columns = [
    { key: 'name', header: t('crm.lead.name'), mobile: 'title' as const, render: (row: Lead) => (
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rose-500 to-fuchsia-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
          {(row.name || '?').charAt(0).toUpperCase()}
        </div>
        <span className="font-medium truncate">{row.name}</span>
      </div>
    )},
    { key: 'company', header: t('crm.lead.company'), mobile: 'subtitle' as const },
    { key: 'phone', header: t('crm.lead.phone'), mobile: 'subtitle' as const, render: (row: Lead) => <span className="font-mono text-xs tabular-nums">{row.phone || '—'}</span> },
    {
      key: 'rating',
      header: t('crm.lead.rating'),
      render: (row: Lead) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ratingColor(row.rating)}`}>{t(`crm.rating.${row.rating}`)}</span>
      ),
    },
    { key: 'value', header: t('crm.lead.estimatedValue'), align: 'right' as const, render: (row: Lead) => <span className="tabular-nums font-medium">{formatCurrency(row.estimatedValue || 0)}</span> },
    { key: 'status', header: t('crm.lead.status'), mobile: 'status' as const, render: (row: Lead) => <StatusBadge status={row.status} /> },
    {
      key: 'actions',
      header: '',
      width: '200px',
      mobile: 'actions' as const,
      render: (row: Lead) => (
        <div className="flex items-center gap-1">
          <ActionButtons
            onView={() => {
              setSelectedLead(row);
              setIsActivityOpen(true);
            }}
            onEdit={() => {
              // Can wrapper will handle permission, but we still expose
              openEdit(row);
            }}
            onDelete={() => setConfirmDelete(row.id)}
            showPrint={false}
          />
          {row.status !== 'converted' && row.status !== 'lost' && (
            <Can action="create" module="crm">
              <Button
                variant="ghost"
                size="sm"
                className="text-emerald-600"
                onClick={() => openConvert(row)}
                title={t('crm.lead.convertToCustomer')}
                aria-label={t('crm.lead.convertToCustomer')}
              >
                <UserCheck size={14} />
              </Button>
            </Can>
          )}
        </div>
      ),
    },
  ];

  const kpiTotal = leadKpis?.total ?? total;
  const kpiNew = leadKpis?.new ?? leads.filter((l) => l.status === 'new').length;
  const kpiQualified = leadKpis?.qualified ?? leads.filter((l) => l.status === 'qualified').length;
  const kpiConverted = leadKpis?.converted ?? leads.filter((l) => l.status === 'converted').length;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page Header */}
      <PageHeader
        icon={<UserPlus size={22} />}
        title={t('crm.leadsPage.title')}
        subtitle={t('crm.leadsPage.description')}
        actions={
          <Can action="create" module="crm">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate} className="shadow-sm">{t('crm.lead.new')}</Button>
          </Can>
        }
      />

      {/* KPI Cards */}
      <StatsGrid
        items={[
          { label: t('crm.leadsPage.total'), value: String(kpiTotal), icon: <Layers size={18} />, tone: 'primary' },
          { label: t('crm.status.new'), value: String(kpiNew), icon: <Flame size={18} />, tone: 'info' },
          { label: t('crm.status.qualified'), value: String(kpiQualified), icon: <ThumbsUp size={18} />, tone: 'warning' },
          { label: t('crm.status.converted'), value: String(kpiConverted), icon: <Handshake size={18} />, tone: 'success' },
        ]}
      />

      {/* Filter Bar */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('crm.leadsPage.search')}
        filterOptions={[
          { key: '', label: t('settings.common.all') },
          { key: 'new', label: t('crm.status.new') },
          { key: 'contacted', label: t('crm.status.contacted') },
          { key: 'qualified', label: t('crm.status.qualified') },
          { key: 'converted', label: t('crm.status.converted') },
          { key: 'lost', label: t('crm.status.lost') },
        ]}
        activeFilter={statusFilter}
        onFilterChange={(key) => setStatusFilter(key)}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={handleExport} title={t('export')} aria-label={t('export')}>
              <FileSpreadsheet size={16} className="text-emerald-600" />
            </Button>
            <span className="text-xs text-slate-500 font-medium tabular-nums">{total}</span>
          </>
        }
      />

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
              columns={columns as unknown as never}
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
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('crm.form.assignedTo')}</label>
            <UserSelect companyId={companyId} value={formData.assignedTo || undefined} onChange={(v) => setFormData((prev) => ({ ...prev, assignedTo: String(v || '') }))} />
          </div>
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
      <Modal
        isOpen={isConvertOpen}
        onClose={() => setIsConvertOpen(false)}
        title={t('crm.lead.convertTitle')}
        size="md"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => setIsConvertOpen(false)}>{t('settings.common.cancel')}</Button>
            <Button variant="primary" onClick={handleConvert}>{t('crm.lead.convertToCustomer')}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('crm.lead.convertMessage')}</p>
          <Input label={t('sales.customer.address')} value={convertForm.address} onChange={(e) => setConvertForm((p) => ({ ...p, address: e.target.value }))} placeholder={t('sales.customer.address')} />
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('sales.customer.taxNumber')} value={convertForm.taxNumber} onChange={(e) => setConvertForm((p) => ({ ...p, taxNumber: e.target.value }))} />
            <Input label={t('sales.customer.creditLimit')} type="number" value={convertForm.creditLimit} onChange={(e) => setConvertForm((p) => ({ ...p, creditLimit: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('sales.customer.phone')} value={convertForm.phone} onChange={(e) => setConvertForm((p) => ({ ...p, phone: e.target.value }))} />
            <Input label={t('sales.customer.email')} type="email" value={convertForm.email} onChange={(e) => setConvertForm((p) => ({ ...p, email: e.target.value }))} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={convertForm.createOpportunity} onChange={(e) => setConvertForm((p) => ({ ...p, createOpportunity: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-primary-600" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">إنشاء فرصة أولى</span>
          </label>
          <p className="text-xs text-slate-500">عند التفعيل سيتم إنشاء فرصة باسم &quot;فرصة {selectedLead?.name}&quot; بنفس القيمة التقديرية.</p>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={t('crm.lead.deleteTitle')}
        message={t('crm.lead.deleteMessage')}
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
        entityLabel={t('crm.lead.name')}
        exactMatch={duplicateExact}
        nearMatches={duplicateNear}
        isEdit={!!editing}
      />
    </div>
  );
};

export default LeadsPage;
