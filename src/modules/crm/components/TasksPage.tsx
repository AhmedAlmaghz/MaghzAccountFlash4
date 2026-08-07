import React, { useState, useMemo } from 'react';
import { CheckSquare, Plus, User, AlertTriangle, Search, Calendar, FileText } from 'lucide-react';
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CheckSquare size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('crm.tasksPage.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('crm.tasksPage.description')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={handleExport} title={t('export')} aria-label={t('export')}>
            <FileText size={16} className="text-emerald-600" />
          </Button>
          <Can action="create" module="crm">
            <Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>
              {t('crm.task.new')}
            </Button>
          </Can>
        </div>
      </div>

      <Card>
        <div className="p-4 flex items-center gap-4 border-b border-slate-200 dark:border-slate-700 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[220px]">
            <Search size={16} className="text-slate-400" />
            <Input
              placeholder={t('crm.tasksPage.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
              aria-label={t('crm.tasksPage.search')}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-300">{t('crm.task.priority')}:</label>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="px-2 py-1 text-sm border rounded-md dark:bg-slate-900 dark:border-slate-600"
              aria-label={t('crm.task.priority')}
            >
              <option value="">{t('settings.common.all')}</option>
              <option value="high">{t('crm.priority.high')}</option>
              <option value="medium">{t('crm.priority.medium')}</option>
              <option value="low">{t('crm.priority.low')}</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-600 dark:text-slate-300">{t('crm.task.title')}:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2 py-1 text-sm border rounded-md dark:bg-slate-900 dark:border-slate-600"
              aria-label={t('crm.task.title')}
            >
              <option value="">{t('settings.common.all')}</option>
              <option value="pending">{t('crm.tasksPage.filter.pending')}</option>
              <option value="completed">{t('crm.tasksPage.filter.completed')}</option>
              <option value="cancelled">{t('crm.tasksPage.filter.cancelled')}</option>
            </select>
          </div>
          <span className="text-xs text-slate-500">{t('crm.total')}: {total}</span>
        </div>
        {isLoading ? (
          <div className="py-12 text-center text-slate-500">{t('settings.common.loading')}</div>
        ) : tasks.length === 0 ? (
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
        ) : (
          <Table<Task>
            data={tasks}
            columns={columns}
            keyExtractor={(row) => row.id}
            emptyMessage={t('crm.task.empty')}
          />
        )}
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={goToPage}
          onPageSizeChange={changePageSize}
        />
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
