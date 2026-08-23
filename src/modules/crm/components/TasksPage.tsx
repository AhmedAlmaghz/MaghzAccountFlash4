import React, { useState, useMemo } from 'react';
import { Plus, User, AlertTriangle, Search, Calendar, FileText, Layers, Clock3, CheckCircle2 } from 'lucide-react';
import { Card, Button, Input, Modal, Table, Pagination } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useAppStore } from '@/core/store';
import { useTasksPaginated, type TaskFilters } from '../hooks/useCrm';
import type { Task } from '../types';
import { Can } from '@/core/ui/components/PermissionGate';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { exportToExcel } from '@/core/utils/exportEngine';
import { useFormatters } from '@/core/utils/useFormatters';

export const TasksPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const { formatDate } = useFormatters(companyId);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const taskFilters = useMemo<TaskFilters>(
    () => ({
      status: statusFilter || undefined,
      priority: priorityFilter || undefined,
      search: search.trim() || undefined,
    }),
    [statusFilter, priorityFilter, search]
  );
  const { tasks, total, page, pageSize, isLoading, goToPage, changePageSize, create, update, remove } = useTasksPaginated(companyId, taskFilters);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    dueDate: new Date().toISOString().split('T')[0],
    priority: 'medium' as Task['priority'],
    status: 'pending' as Task['status'],
    assignedTo: '',
    leadId: '',
    opportunityId: '',
    customerId: '',
  });

  const resetForm = () => {
    setFormData({ title: '', description: '', dueDate: new Date().toISOString().split('T')[0], priority: 'medium', status: 'pending', assignedTo: '', leadId: '', opportunityId: '', customerId: '' });
    setEditing(null);
  };

  const openCreate = () => { resetForm(); setIsModalOpen(true); };
  const openEdit = (task: Task) => {
    setEditing(task);
    setFormData({
      title: task.title,
      description: task.description || '',
      dueDate: task.dueDate || '',
      priority: task.priority,
      status: task.status,
      assignedTo: task.assignedTo || '',
      leadId: task.leadId || '',
      opportunityId: task.opportunityId || '',
      customerId: task.customerId || '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.title) {
      addToast('error', t('crm.form.title') + ' ' + t('error'));
      return;
    }
    const payload = {
      companyId,
      title: formData.title,
      description: formData.description || undefined,
      dueDate: formData.dueDate || undefined,
      priority: formData.priority,
      status: formData.status,
      assignedTo: formData.assignedTo || undefined,
      leadId: formData.leadId || undefined,
      opportunityId: formData.opportunityId || undefined,
      customerId: formData.customerId || undefined,
    };
    const res = editing ? await update(editing.id, payload) : await create(payload);
    if (res?.success) {
      setIsModalOpen(false);
      resetForm();
      addToast('success', t(editing ? 'crm.task.updated' : 'crm.task.created'));
    } else {
      addToast('error', res?.error || t('error'));
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const res = await remove(confirmDelete);
    if (res?.success) {
      setConfirmDelete(null);
      addToast('success', t('crm.task.deleted'));
    } else {
      addToast('error', res?.error || t('error'));
    }
  };

  const toggleStatus = async (task: Task) => {
    const newStatus: Task['status'] = task.status === 'pending' ? 'completed' : 'pending';
    const res = await update(task.id, { status: newStatus });
    if (res?.success) {
      addToast('success', t('crm.task.updated'));
    } else {
      addToast('error', res?.error || t('error'));
    }
  };

  const isOverdue = (task: Task) => {
    if (!task.dueDate || task.status === 'completed' || task.status === 'cancelled') return false;
    return new Date(task.dueDate) < new Date(new Date().toDateString());
  };

  const handleExport = () => {
    const cols = [
      { key: 'title', header: t('crm.form.title') },
      { key: 'priority', header: t('crm.task.priority') },
      { key: 'status', header: t('crm.form.title') },
      { key: 'dueDate', header: t('crm.task.dueDate') },
      { key: 'assignedName', header: t('crm.task.assignedTo') },
    ];
    const data = tasks.map(tk => ({
      title: tk.title,
      priority: t(`crm.priority.${tk.priority}`),
      status: tk.status,
      dueDate: tk.dueDate || '',
      assignedName: tk.assignedName || tk.assignedTo || '-',
    }));
    exportToExcel(data, cols, `tasks_${new Date().toISOString().split('T')[0]}`);
  };

  const columns = [
    {
      key: 'title',
      header: t('crm.task.title'),
      render: (row: Task) => (
        <div className="flex items-center gap-2">
          {isOverdue(row) && <AlertTriangle size={14} className="text-rose-500" aria-label={t('crm.task.overdue')} />}
          <div>
            <p className={row.status === 'completed' ? 'line-through text-slate-400' : 'font-medium'}>{row.title}</p>
            {row.description && <p className="text-xs text-slate-400">{row.description}</p>}
          </div>
        </div>
      ),
    },
    {
      key: 'assignedTo',
      header: t('crm.task.assignedTo'),
      width: '140px',
      render: (row: Task) => (
        <div className="flex items-center gap-1 text-sm text-slate-500">
          <User size={14} />
          {row.assignedName || row.assignedTo || '—'}
        </div>
      ),
    },
    {
      key: 'dueDate',
      header: t('crm.task.dueDate'),
      width: '130px',
      render: (row: Task) => {
        if (!row.dueDate) return '—';
        const overdue = isOverdue(row);
        return (
          <span className={`flex items-center gap-1 ${overdue ? 'text-rose-600 font-medium' : ''}`}>
            <Calendar size={12} /> {formatDate(row.dueDate)}
          </span>
        );
      },
    },
    {
      key: 'priority',
      header: t('crm.task.priority'),
      width: '100px',
      render: (row: Task) => (
        <span className={`px-2 py-0.5 rounded-full text-xs ${priorityColor(row.priority)}`}>{t(`crm.priority.${row.priority}`)}</span>
      ),
    },
    {
      key: 'status',
      header: t('crm.task.title'),
      width: '100px',
      render: (row: Task) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => toggleStatus(row)}
          className={row.status === 'completed' ? 'text-emerald-600' : 'text-slate-500'}
        >
          {row.status === 'completed' ? t('crm.task.statusCompleted') : t('crm.task.statusPending')}
        </Button>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '110px',
      render: (row: Task) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="text-amber-600" onClick={() => openEdit(row)}>{t('settings.common.edit')}</Button>
          <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => setConfirmDelete(row.id)}>{t('settings.common.delete')}</Button>
        </div>
      ),
    },
  ];

  const kpis = useMemo(() => ({
    pending: tasks.filter((tk) => tk.status === 'pending').length,
    completed: tasks.filter((tk) => tk.status === 'completed').length,
    overdue: tasks.filter((tk) => isOverdue(tk)).length,
  }), [tasks]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Gradient Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-700 via-sky-600 to-cyan-600 shadow-xl shadow-sky-900/10 dark:shadow-sky-900/20">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
        <div className="relative px-6 py-10 sm:px-8 sm:py-12 text-white">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-sky-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
              <Layers size={12} /> {t('crm.tasksPage.title')}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t('crm.tasksPage.title')}</h2>
              <p className="text-sky-100/80 text-base max-w-lg">{t('crm.tasksPage.description')}</p>
            </div>
            <Can action="create" module="crm">
              <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={openCreate} className="bg-white/10 hover:bg-white/20 text-white border-white/20 shrink-0">{t('crm.task.new')}</Button>
            </Can>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('crm.total'), value: String(total), icon: Layers, color: 'from-sky-600 to-sky-700', bg: 'bg-gradient-to-br from-sky-50 to-sky-100 dark:from-sky-900/10 dark:to-sky-800/5' },
          { label: t('crm.tasksPage.filter.pending'), value: String(kpis.pending), icon: Clock3, color: 'from-amber-600 to-amber-700', bg: 'bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/10 dark:to-amber-800/5' },
          { label: t('crm.tasksPage.filter.completed'), value: String(kpis.completed), icon: CheckCircle2, color: 'from-emerald-600 to-emerald-700', bg: 'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/10 dark:to-emerald-800/5' },
          { label: t('crm.task.overdue'), value: String(kpis.overdue), icon: AlertTriangle, color: 'from-rose-600 to-rose-700', bg: 'bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-900/10 dark:to-rose-800/5' },
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
      <Card noPadding className="p-4 sm:p-5 border-t-2 border-sky-500/30">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
          <div className="relative flex-1 min-w-0 max-w-md">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder={t('crm.tasksPage.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t('crm.tasksPage.search')}
              className="w-full pr-9 pl-9 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="مسح"><Search size={13} /></button>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={handleExport} title={t('export')} aria-label={t('export')}>
            <FileText size={16} className="text-emerald-600" />
          </Button>
          <span className="text-xs text-slate-500 font-medium tabular-nums mr-auto">{total}</span>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 font-medium">{t('crm.task.priority')}:</span>
          {[
            { v: '', l: t('settings.common.all') },
            { v: 'high', l: t('crm.priority.high') },
            { v: 'medium', l: t('crm.priority.medium') },
            { v: 'low', l: t('crm.priority.low') },
          ].map((o) => (
            <button
              key={o.v || 'all'}
              onClick={() => setPriorityFilter(o.v)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${priorityFilter === o.v ? 'bg-sky-600 text-white border-sky-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-sky-300'}`}
            >{o.l}</button>
          ))}
          <span className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />
          {[
            { v: '', l: t('settings.common.all') },
            { v: 'pending', l: t('crm.tasksPage.filter.pending') },
            { v: 'completed', l: t('crm.tasksPage.filter.completed') },
            { v: 'cancelled', l: t('crm.tasksPage.filter.cancelled') },
          ].map((o) => (
            <button
              key={'s-' + (o.v || 'all')}
              onClick={() => setStatusFilter(o.v)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === o.v ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-sky-300'}`}
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
        ) : tasks.length === 0 ? (
          <div className="py-8">
            <EmptyState
              icon="inbox"
              title={t('crm.task.empty')}
              description={t('crm.task.emptyDescription')}
              action={
                <Can action="create" module="crm">
                  <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>
                    {t('crm.task.new')}
                  </Button>
                </Can>
              }
            />
          </div>
        ) : (
          <>
            <Table<Task>
              data={tasks}
              columns={columns}
              keyExtractor={(row) => row.id}
              emptyMessage={t('crm.task.empty')}
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
        title={editing ? t('crm.task.edit') : t('crm.task.new')}
        size="md"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => { setIsModalOpen(false); resetForm(); }}>{t('settings.common.cancel')}</Button>
            <Button variant="primary" onClick={handleSave}>{t('settings.common.save')}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input label={t('crm.form.title')} value={formData.title} onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))} required />
          <Input label={t('crm.form.description')} value={formData.description} onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))} />
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('crm.form.dueDate')} type="date" value={formData.dueDate} onChange={(e) => setFormData((prev) => ({ ...prev, dueDate: e.target.value }))} />
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('crm.task.priority')}</label>
              <select value={formData.priority} onChange={(e) => setFormData((prev) => ({ ...prev, priority: e.target.value as Task['priority'] }))} className="form-control">
                <option value="low">{t('crm.priority.low')}</option>
                <option value="medium">{t('crm.priority.medium')}</option>
                <option value="high">{t('crm.priority.high')}</option>
              </select>
            </div>
          </div>
          {editing && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('crm.task.title')}</label>
              <select value={formData.status} onChange={(e) => setFormData((prev) => ({ ...prev, status: e.target.value as Task['status'] }))} className="form-control">
                <option value="pending">{t('crm.tasksPage.filter.pending')}</option>
                <option value="completed">{t('crm.tasksPage.filter.completed')}</option>
                <option value="cancelled">{t('crm.tasksPage.filter.cancelled')}</option>
              </select>
            </div>
          )}
          <Input label={t('crm.form.assignedTo')} value={formData.assignedTo} onChange={(e) => setFormData((prev) => ({ ...prev, assignedTo: e.target.value }))} />
          <Input label={t('crm.form.customerOrOpportunity')} value={formData.opportunityId || formData.leadId || formData.customerId} onChange={(e) => setFormData((prev) => ({ ...prev, opportunityId: e.target.value }))} />
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={t('crm.task.deleteTitle')}
        message={t('crm.task.deleteMessage')}
        variant="danger"
      />
    </div>
  );
};

function priorityColor(priority: Task['priority']) {
  const colors: Record<string, string> = { low: 'bg-slate-100 text-slate-700', medium: 'bg-amber-100 text-amber-700', high: 'bg-rose-100 text-rose-700' };
  return colors[priority] || 'bg-slate-100 text-slate-700';
}

export default TasksPage;
