import React, { useState, useMemo, useRef } from 'react';
import { Plus, Phone, Mail, Users, MapPin, FileText, BarChart3, Search, FileSpreadsheet, Layers, Clock3 } from 'lucide-react';
import { Card, Button, Input, Modal, Table, Pagination } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { DuplicateWarningDialog } from '@/core/ui/components/DuplicateWarningDialog';
import { detectDuplicates } from '@/core/utils/duplicateDetection';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useAppStore } from '@/core/store';
import { useActivitiesPaginated, useActivityKpis, type ActivityFilters } from '../hooks/useCrm';
import type { Activity as ActivityType } from '../types';
import { Can } from '@/core/ui/components/PermissionGate';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useFormatters } from '@/core/utils/useFormatters';
import { exportToExcel } from '@/core/utils/exportEngine';
import { crmApi } from '../api';
import { UserSelect } from '@/core/ui/components/smart/fields/UserSelect';
import { LeadSelect } from '@/core/ui/components/smart/fields/LeadSelect';
import { OpportunitySelect } from '@/core/ui/components/smart/fields/OpportunitySelect';
import { CustomerSelect } from '@/core/ui/components/smart/fields/CustomerSelect';

const TYPE_ICONS: Record<string, React.ReactNode> = {
  call: <Phone size={14} />,
  meeting: <Users size={14} />,
  email: <Mail size={14} />,
  visit: <MapPin size={14} />,
  note: <FileText size={14} />,
};

const TYPE_KEYS: Record<string, string> = {
  call: 'crm.activity.call',
  meeting: 'crm.activity.meeting',
  email: 'crm.activity.email',
  visit: 'crm.activity.visit',
  note: 'crm.activity.note',
};

const ACTIVITY_TYPES: ActivityType['type'][] = ['call', 'meeting', 'email', 'visit', 'note'];

export const ActivitiesPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const { formatDate } = useFormatters(companyId);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const activityFilters = useMemo<ActivityFilters>(
    () => ({
      type: typeFilter || undefined,
      search: search.trim() || undefined,
    }),
    [typeFilter, search]
  );
  const { activities, total, page, pageSize, isLoading, goToPage, changePageSize, create, update, remove } = useActivitiesPaginated(companyId, activityFilters);
  const { kpis: activityKpis } = useActivityKpis(companyId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<ActivityType | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);

  const [formData, setFormData] = useState({
    type: 'call' as ActivityType['type'],
    subject: '',
    description: '',
    activityDate: new Date().toISOString().split('T')[0],
    durationMinutes: '',
    assignedTo: '',
    leadId: '',
    opportunityId: '',
    customerId: '',
  });

  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateInputName, setDuplicateInputName] = useState('');
  const [duplicateExact, setDuplicateExact] = useState<{ name: string; code?: string } | null>(null);
  const [duplicateNear, setDuplicateNear] = useState<Array<{ name: string; code?: string; score: number }>>([]);
  const duplicateConfirmedRef = useRef(false);

  const resetForm = () => {
    setFormData({ type: 'call', subject: '', description: '', activityDate: new Date().toISOString().split('T')[0], durationMinutes: '', assignedTo: '', leadId: '', opportunityId: '', customerId: '' });
    setEditing(null);
  };

  const openCreate = () => { resetForm(); setIsModalOpen(true); };
  const openEdit = (act: ActivityType) => {
    setEditing(act);
    const dt = act.activityDate ? act.activityDate.split('T')[0] : new Date().toISOString().split('T')[0];
    setFormData({
      type: act.type,
      subject: act.subject,
      description: act.description || '',
      activityDate: dt,
      durationMinutes: String(act.durationMinutes || ''),
      assignedTo: act.assignedTo || '',
      leadId: act.leadId || '',
      opportunityId: act.opportunityId || '',
      customerId: act.customerId || '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.subject) {
      addToast('error', t('crm.activity.subject') + ' ' + t('error'));
      return;
    }
    const inputName = formData.subject.trim();
    if (!duplicateConfirmedRef.current && inputName) {
      try {
        const allRes = await crmApi.getActivities(companyId);
        if (allRes.success && allRes.data) {
          const result = detectDuplicates(inputName, allRes.data as ActivityType[], (a) => a.subject, {
            excludeId: editing?.id,
            getId: (a) => a.id,
            getCode: (a) => a.activityDate,
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
    duplicateConfirmedRef.current = false;
    const payload = {
      companyId,
      type: formData.type,
      subject: formData.subject,
      description: formData.description || undefined,
      activityDate: formData.activityDate,
      durationMinutes: Number(formData.durationMinutes) || undefined,
      assignedTo: formData.assignedTo || undefined,
      leadId: formData.leadId || undefined,
      opportunityId: formData.opportunityId || undefined,
      customerId: formData.customerId || undefined,
    };
    const res = editing ? await update(editing.id, payload) : await create(payload);
    if (res?.success) {
      setIsModalOpen(false);
      resetForm();
      addToast('success', t(editing ? 'crm.activity.updated' : 'crm.activity.created'));
    } else {
      addToast('error', res?.error || t('error'));
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const res = await remove(confirmDelete);
    if (res?.success) {
      setConfirmDelete(null);
      addToast('success', t('crm.activity.deleted'));
    } else {
      addToast('error', res?.error || t('error'));
    }
  };

  const repReport = React.useMemo(() => {
    const map = new Map<string, { count: number; duration: number }>();
    activities.forEach((a) => {
      const key = a.assignedName || a.assignedTo || t('crm.activity.unassigned');
      const curr = map.get(key) || { count: 0, duration: 0 };
      curr.count += 1;
      curr.duration += a.durationMinutes || 0;
      map.set(key, curr);
    });
    return Array.from(map.entries()).map(([name, data]) => ({ name, ...data }));
  }, [activities, t]);

  const handleExport = () => {
    const cols = [
      { key: 'type', header: t('crm.activity.type') },
      { key: 'subject', header: t('crm.activity.subject') },
      { key: 'activityDate', header: t('crm.activity.date') },
      { key: 'durationMinutes', header: t('crm.activity.duration') },
      { key: 'assignedName', header: t('crm.activity.assignedTo') },
    ];
    const data = activities.map(act => ({
      type: t(TYPE_KEYS[act.type] || 'crm.activity.note'),
      subject: act.subject,
      activityDate: act.activityDate,
      durationMinutes: act.durationMinutes || 0,
      assignedName: act.assignedName || act.assignedTo || '-',
    }));
    void exportToExcel(data, cols, `activities_${new Date().toISOString().split('T')[0]}`);
  };

  const columns = [
    {
      key: 'type',
      header: t('crm.activity.type'),
      width: '100px',
      render: (row: ActivityType) => (
        <div className="flex items-center gap-1 text-sm text-slate-600">
          {TYPE_ICONS[row.type]}
          <span>{t(TYPE_KEYS[row.type])}</span>
        </div>
      ),
    },
    {
      key: 'subject',
      header: t('crm.activity.subject'),
      render: (row: ActivityType) => (
        <div>
          <p className="font-medium">{row.subject}</p>
          {row.description && <p className="text-xs text-slate-400 line-clamp-1">{row.description}</p>}
        </div>
      ),
    },
    { key: 'activityDate', header: t('crm.activity.date'), width: '120px', render: (row: ActivityType) => formatDate(row.activityDate) },
    {
      key: 'durationMinutes',
      header: t('crm.activity.duration'),
      width: '100px',
      render: (row: ActivityType) => (row.durationMinutes ? `${row.durationMinutes} ${t('crm.activity.minutesUnit')}` : '—'),
    },
    {
      key: 'assignedTo',
      header: t('crm.activity.assignedTo'),
      width: '140px',
      render: (row: ActivityType) => row.assignedName || row.assignedTo || '—',
    },
    {
      key: 'actions',
      header: '',
      width: '140px',
      render: (row: ActivityType) => (
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

  const kpiCalls = activityKpis?.calls ?? activities.filter((a) => a.type === 'call').length;
  const kpiMeetings = activityKpis?.meetings ?? activities.filter((a) => a.type === 'meeting').length;
  const kpiTotalMinutes = activityKpis?.totalMinutes ?? (activityKpis?.total_minutes as number) ?? activities.reduce((s, a) => s + (a.durationMinutes || 0), 0);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Gradient Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-700 via-teal-600 to-cyan-600 shadow-xl shadow-teal-900/10 dark:shadow-teal-900/20">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
        <div className="relative px-6 py-10 sm:px-8 sm:py-12 text-white">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-teal-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
              <Layers size={12} /> {t('crm.activitiesPage.title')}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t('crm.activitiesPage.title')}</h2>
              <p className="text-teal-100/80 text-base max-w-lg">{t('crm.activitiesPage.description')}</p>
            </div>
            <Can action="create" module="crm">
              <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={openCreate} className="bg-white/10 hover:bg-white/20 text-white border-white/20 shrink-0">{t('crm.activity.new')}</Button>
            </Can>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('crm.total'), value: String(total), icon: Layers, color: 'from-teal-600 to-teal-700', bg: 'bg-gradient-to-br from-teal-50 to-teal-100 dark:from-teal-900/10 dark:to-teal-800/5' },
          { label: t('crm.activity.call'), value: String(kpiCalls), icon: Phone, color: 'from-blue-600 to-blue-700', bg: 'bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/10 dark:to-blue-800/5' },
          { label: t('crm.activity.meeting'), value: String(kpiMeetings), icon: Users, color: 'from-fuchsia-600 to-fuchsia-700', bg: 'bg-gradient-to-br from-fuchsia-50 to-fuchsia-100 dark:from-fuchsia-900/10 dark:to-fuchsia-800/5' },
          { label: t('crm.activities.totalMinutes'), value: String(kpiTotalMinutes), icon: Clock3, color: 'from-amber-600 to-amber-700', bg: 'bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/10 dark:to-amber-800/5' },
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
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
          <div className="relative flex-1 min-w-0 max-w-md">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder={t('search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t('search')}
              className="w-full pr-9 pl-9 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="مسح"><Search size={13} /></button>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={handleExport} title={t('export')} aria-label={t('export')}>
            <FileSpreadsheet size={16} className="text-emerald-600" />
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<BarChart3 size={15} />} onClick={() => setShowReport(true)}>
            {t('crm.activities.performanceReport')}
          </Button>
          <span className="text-xs text-slate-500 font-medium tabular-nums mr-auto">{total}</span>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 font-medium">{t('crm.activity.type')}:</span>
          {[
            { v: '', l: t('crm.activitiesPage.filter.all') },
            ...ACTIVITY_TYPES.map((tp) => ({ v: tp as string, l: t(TYPE_KEYS[tp]) })),
          ].map((o) => (
            <button
              key={o.v || 'all'}
              onClick={() => setTypeFilter(o.v)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${typeFilter === o.v ? 'bg-teal-600 text-white border-teal-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-teal-300'}`}
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
        ) : activities.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon="inbox"
              title={t('crm.activity.empty')}
              description={t('crm.activity.emptyDescription')}
              action={
                <Can action="create" module="crm">
                  <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>
                    {t('crm.activity.new')}
                  </Button>
                </Can>
              }
            />
          </div>
        ) : (
          <>
            <Table<ActivityType>
              data={activities}
              columns={columns as unknown as never}
              keyExtractor={(row) => row.id}
              emptyMessage={t('crm.activity.empty')}
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

      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); resetForm(); }}
        title={editing ? t('crm.activity.edit') : t('crm.activity.new')}
        size="md"
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
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('crm.activity.type')}</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData((prev) => ({ ...prev, type: e.target.value as ActivityType['type'] }))}
                className="form-control"
              >
                <option value="call">{t('crm.activity.call')}</option>
                <option value="meeting">{t('crm.activity.meeting')}</option>
                <option value="email">{t('crm.activity.email')}</option>
                <option value="visit">{t('crm.activity.visit')}</option>
                <option value="note">{t('crm.activity.note')}</option>
              </select>
            </div>
            <Input label={t('crm.activity.date')} type="date" value={formData.activityDate} onChange={(e) => setFormData((prev) => ({ ...prev, activityDate: e.target.value }))} />
          </div>
          <Input label={t('crm.activity.subject')} value={formData.subject} onChange={(e) => setFormData((prev) => ({ ...prev, subject: e.target.value }))} required />
          <Input label={t('crm.activity.details')} value={formData.description} onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))} />
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('crm.activity.duration')} type="number" min={0} value={formData.durationMinutes} onChange={(e) => setFormData((prev) => ({ ...prev, durationMinutes: e.target.value }))} />
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('crm.activity.assignedTo')}</label>
              <UserSelect companyId={companyId} value={formData.assignedTo || undefined} onChange={(v) => setFormData((prev) => ({ ...prev, assignedTo: String(v || '') }))} />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">العميل المحتمل</label>
              <LeadSelect companyId={companyId} value={formData.leadId || undefined} onChange={(v) => setFormData((prev) => ({ ...prev, leadId: String(v || '') }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">الفرصة</label>
              <OpportunitySelect companyId={companyId} value={formData.opportunityId || undefined} onChange={(v) => setFormData((prev) => ({ ...prev, opportunityId: String(v || '') }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">العميل</label>
              <CustomerSelect companyId={companyId} value={formData.customerId || undefined} onChange={(v) => setFormData((prev) => ({ ...prev, customerId: String(v || '') }))} />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showReport}
        onClose={() => setShowReport(false)}
        title={t('crm.activities.repReportTitle')}
        size="md"
        footer={<Button variant="secondary" onClick={() => setShowReport(false)}>{t('settings.common.close')}</Button>}
      >
        <div className="space-y-4">
          {repReport.length === 0 ? (
            <EmptyState title={t('crm.activities.noData')} description={t('crm.activities.noDataDescription')} />
          ) : (
            <Table
              data={repReport}
              columns={[
                { key: 'name', header: t('crm.activities.repName') },
                { key: 'count', header: t('crm.activities.activityCount'), width: '120px' },
                { key: 'duration', header: t('crm.activities.totalMinutes'), width: '140px' },
              ]}
              keyExtractor={(row, i) => `${row.name}-${i}`}
            />
          )}
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={t('crm.activity.deleteTitle')}
        message={t('crm.activity.deleteMessage')}
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
        entityLabel={t('crm.activity.subject')}
        exactMatch={duplicateExact}
        nearMatches={duplicateNear}
        isEdit={!!editing}
      />
    </div>
  );
};

export default ActivitiesPage;
