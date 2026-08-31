import React, { useState, useRef, useMemo, useCallback } from 'react';
import { Users, Plus, User, Search, Wallet, CheckSquare, XCircle, Layers } from 'lucide-react';
import { Card, Button, Input, Modal, Table, Pagination } from '@/core/ui/components';
import { ConfirmDialog } from '@/core/ui/components/ConfirmDialog';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { ActionButtons } from '@/core/ui/components/ActionButtons';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useAppStore } from '@/core/store';
import { useFormatters } from '@/core/utils/useFormatters';
import { useEmployeesPaginated, useDepartments } from '../hooks/useHr';
import type { Employee } from '../types';
import { Can } from '@/core/ui/components/PermissionGate';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { useToastStore } from '@/core/store/toastStore';
import { DuplicateWarningDialog } from '@/core/ui/components/DuplicateWarningDialog';
import { detectDuplicates } from '@/core/utils/duplicateDetection';
import { hrApi } from '../api';

export const EmployeesPage: React.FC = () => {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { getNextNumber } = useDocumentSequence();
  const [isActiveFilter, setIsActiveFilter] = useState<boolean | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const employeeFilters = useMemo(() => ({ isActive: isActiveFilter, search: searchQuery || undefined }), [isActiveFilter, searchQuery]);
  const { employees, total, page, pageSize, isLoading, goToPage, changePageSize, create, update, remove } = useEmployeesPaginated(companyId, employeeFilters);
  const { departments } = useDepartments(companyId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [viewing, setViewing] = useState<Employee | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateInputName, setDuplicateInputName] = useState('');
  const [duplicateExact, setDuplicateExact] = useState<{ name: string; code?: string } | null>(null);
  const [duplicateNear, setDuplicateNear] = useState<Array<{ name: string; code?: string; score: number }>>([]);
  const duplicateConfirmedRef = useRef(false);

  const [formData, setFormData] = useState({
    employeeNumber: '', fullName: '', nationalId: '', phone: '', email: '',
    address: '', departmentId: '', position: '', grade: '', hireDate: '', baseSalary: '',
    openingBalance: '',
    isActive: true, photoUrl: '', attachments: [] as string[],
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const resetForm = useCallback(() => {
    setFormData({
      employeeNumber: '', fullName: '', nationalId: '', phone: '', email: '',
      address: '', departmentId: '', position: '', grade: '', hireDate: '', baseSalary: '',
      openingBalance: '',
      isActive: true, photoUrl: '', attachments: [],
    });
    setEditing(null);
  }, []);

  const openCreate = useCallback(async () => {
    resetForm();
    if (activeCompany) {
      const seq = await getNextNumber('employee', activeCompany.id);
      if (seq?.number) setFormData(prev => ({ ...prev, employeeNumber: seq.number || '' }));
    }
    setIsModalOpen(true);
  }, [resetForm, activeCompany, getNextNumber]);

  const openEdit = useCallback((emp: Employee) => {
    setEditing(emp);
    setFormData({
      employeeNumber: emp.employeeNumber,
      fullName: emp.fullName,
      nationalId: emp.nationalId || '',
      phone: emp.phone || '',
      email: emp.email || '',
      address: emp.address || '',
      departmentId: emp.departmentId || '',
      position: emp.position || '',
      grade: emp.grade || '',
      hireDate: emp.hireDate || '',
      baseSalary: emp.baseSalary !== undefined ? String(emp.baseSalary) : '',
      openingBalance: emp.openingBalancePosted ? String(emp.openingBalance || '') : '',
      isActive: emp.isActive,
      photoUrl: emp.photoUrl || '',
      attachments: emp.attachments || [],
    });
    setIsModalOpen(true);
  }, []);

  const openView = useCallback((emp: Employee) => {
    setViewing(emp);
    setIsDetailOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    resetForm();
  }, [resetForm]);

  const handleSave = async () => {
    if (!formData.employeeNumber || !formData.fullName) {
      addToast('error', t('hr.employeesPage.requiredFields') || 'يرجى ملء الحقول المطلوبة');
      return;
    }
    const inputName = formData.fullName.trim();
    if (!duplicateConfirmedRef.current && inputName) {
      try {
        const allRes = await hrApi.getEmployees(companyId);
        if (allRes.success && allRes.data) {
          const result = detectDuplicates(inputName, allRes.data as Employee[], (e) => e.fullName, {
            excludeId: editing?.id || undefined,
            getId: (e) => e.id,
            getCode: (e) => e.employeeNumber,
            nearThreshold: 0.85,
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
        /* فشل الفحص لا يمنع الحفظ */
      }
    }
    duplicateConfirmedRef.current = false;
    const payload = {
      companyId,
      employeeNumber: formData.employeeNumber,
      fullName: formData.fullName,
      nationalId: formData.nationalId || undefined,
      phone: formData.phone || undefined,
      email: formData.email || undefined,
      address: formData.address || undefined,
      departmentId: formData.departmentId || undefined,
      position: formData.position || undefined,
      grade: formData.grade || undefined,
      hireDate: formData.hireDate || undefined,
      baseSalary: formData.baseSalary ? Number(formData.baseSalary) : undefined,
      openingBalance: editing ? undefined : (Number(formData.openingBalance) || 0),
      isActive: formData.isActive,
      photoUrl: formData.photoUrl || undefined,
      attachments: formData.attachments,
    };
    const res = editing ? await update(editing.id, payload) : await create(payload);
    if (res.success) {
      addToast('success', editing ? t('hr.employeesPage.updated') : t('hr.employeesPage.created'));
      setIsModalOpen(false);
      resetForm();
    } else {
      addToast('error', res.error || t('common.error'));
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const res = await remove(confirmDelete);
    if (res.success) {
      addToast('success', t('hr.employeesPage.deleted'));
    } else {
      addToast('error', res.error || t('common.error'));
    }
    setConfirmDelete(null);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      addToast('error', t('hr.employeesPage.photoTooLarge') || 'حجم الصورة كبير جداً (الحد 2 ميجابايت)');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setFormData((prev) => ({ ...prev, photoUrl: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  const columns = useMemo(() => [
    { key: 'employeeNumber', header: t('hr.employeesPage.employeeNumber'), width: '120px', render: (row: Employee) => (
      <span className="font-mono text-xs font-semibold bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 flex items-center gap-1 w-fit">
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
        {row.employeeNumber}
      </span>
    )},
    { key: 'fullName', header: t('hr.employeesPage.name'), render: (row: Employee) => (
      <div className="flex items-center gap-2 min-w-0">
        {row.photoUrl
          ? <img src={row.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
          : <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0">{(row.fullName || '?').charAt(0).toUpperCase()}</div>}
        <span className="font-medium truncate">{row.fullName}</span>
      </div>
    )},
    { key: 'position', header: t('hr.employeesPage.position') },
    { key: 'departmentName', header: t('hr.employeesPage.department'), render: (row: Employee) => row.departmentName || row.departmentId || '—' },
    { key: 'baseSalary', header: t('hr.employeesPage.baseSalary'), align: 'right' as const, render: (row: Employee) => <span className="tabular-nums font-medium">{formatCurrency(row.baseSalary || 0)}</span> },
    { key: 'isActive', header: t('hr.employeesPage.status'), width: '110px', render: (row: Employee) => <StatusBadge status={row.isActive ? 'active' : 'inactive'} /> },
    { key: 'actions', header: '', width: '140px', render: (row: Employee) => (
      <ActionButtons onView={() => openView(row)} onEdit={() => openEdit(row)} onDelete={() => setConfirmDelete(row.id)} showPrint={false} />
    )},
  ], [t, formatCurrency, openView, openEdit]);

  const kpis = useMemo(() => {
    const active = employees.filter((e) => e.isActive).length;
    const inactive = employees.length - active;
    const payrollMass = employees.reduce((s, e) => s + Number(e.baseSalary || 0), 0);
    return { active, inactive, payrollMass };
  }, [employees]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Gradient Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-600 shadow-xl shadow-indigo-900/10 dark:shadow-indigo-900/20">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
        <div className="relative px-6 py-10 sm:px-8 sm:py-12 text-white">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-indigo-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
              <Layers size={12} /> {t('hr.employeesPage.title')}
            </span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t('hr.employeesPage.title')}</h2>
              <p className="text-indigo-100/80 text-base max-w-lg">{t('hr.employeesPage.subtitle')}</p>
            </div>
            <Can action="create" module="hr">
              <Button variant="secondary" leftIcon={<Plus size={16} />} onClick={openCreate} className="bg-white/10 hover:bg-white/20 text-white border-white/20 shrink-0">{t('hr.employeesPage.new')}</Button>
            </Can>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: t('hr.employeesPage.total'), value: String(total), icon: Users, color: 'from-indigo-600 to-indigo-700', bg: 'bg-gradient-to-br from-indigo-50 to-indigo-100 dark:from-indigo-900/10 dark:to-indigo-800/5' },
          { label: t('settings.common.active'), value: String(kpis.active), icon: CheckSquare, color: 'from-emerald-600 to-emerald-700', bg: 'bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/10 dark:to-emerald-800/5' },
          { label: t('settings.common.inactive'), value: String(kpis.inactive), icon: XCircle, color: 'from-slate-600 to-slate-700', bg: 'bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900/10 dark:to-slate-800/5' },
          { label: t('hr.employeesPage.payrollMass'), value: formatCurrency(kpis.payrollMass), icon: Wallet, color: 'from-violet-600 to-violet-700', bg: 'bg-gradient-to-br from-violet-50 to-violet-100 dark:from-violet-900/10 dark:to-violet-800/5' },
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
      <Card noPadding className="p-4 sm:p-5 border-t-2 border-indigo-500/30">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
          <div className="relative flex-1 min-w-0 max-w-md">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('hr.employeesPage.searchPlaceholder')}
              aria-label={t('hr.employeesPage.searchPlaceholder')}
              className="w-full pr-9 pl-9 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-colors"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label="مسح"><XCircle size={14} /></button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-500 font-medium">{t('hr.employeesPage.filterLabel')}:</span>
            {[
              { v: 'all', l: t('settings.common.all') },
              { v: 'active', l: t('settings.common.active') },
              { v: 'inactive', l: t('settings.common.inactive') },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => setIsActiveFilter(o.v === 'all' ? undefined : o.v === 'active')}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${(isActiveFilter === undefined ? 'all' : isActiveFilter ? 'active' : 'inactive') === o.v ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300'}`}
              >{o.l}</button>
            ))}
          </div>
          <span className="text-xs text-slate-500 mr-auto font-medium tabular-nums">{total}</span>
        </div>
      </Card>

      <Card noPadding>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : employees.length === 0 && !searchQuery && isActiveFilter === undefined ? (
          <div className="py-8">
            <EmptyState icon="inbox" title={t('hr.employeesPage.emptyTitle')} description={t('hr.employeesPage.emptyDescription')} action={<Can action="create" module="hr"><Button variant="primary" leftIcon={<Plus size={16} />} onClick={openCreate}>{t('hr.employeesPage.new')}</Button></Can>} />
          </div>
        ) : employees.length === 0 ? (
          <div className="py-10">
            <EmptyState icon="search" title={t('sales.filter.noResults')} description={t('sales.filter.noResultsDesc')} action={
              <Button variant="secondary" onClick={() => { setSearchQuery(''); setIsActiveFilter(undefined); }}>{t('sales.filter.clearFilters')}</Button>
            } />
          </div>
        ) : (
          <Table<Employee>
            data={employees}
            columns={columns}
            keyExtractor={(row) => row.id}
            emptyMessage={t('hr.employeesPage.emptyMessage')}
          />
        )}
        <div className="border-t border-slate-200 dark:border-slate-800">
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={goToPage}
            onPageSizeChange={changePageSize}
          />
        </div>
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editing ? t('hr.employeesPage.edit') : t('hr.employeesPage.new')}
        size="lg"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={closeModal}>{t('settings.common.cancel')}</Button>
            <Button variant="primary" onClick={handleSave}>{t('settings.common.save')}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center overflow-hidden">
                {formData.photoUrl ? <img src={formData.photoUrl} alt="" className="w-full h-full object-cover" /> : <User size={32} className="text-slate-400" />}
              </div>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="absolute bottom-0 left-0 bg-primary-600 text-white rounded-full p-1" title={t('hr.employeesPage.uploadPhoto') || 'تحميل صورة'}>
                <Plus size={12} />
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
            </div>
            <div className="flex-1" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('hr.employeesPage.employeeNumber')} value={formData.employeeNumber} onChange={(e) => setFormData((prev) => ({ ...prev, employeeNumber: e.target.value }))} required />
            <Input label={t('hr.employeesPage.fullName')} value={formData.fullName} onChange={(e) => setFormData((prev) => ({ ...prev, fullName: e.target.value }))} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('hr.employeesPage.nationalId')} value={formData.nationalId} onChange={(e) => setFormData((prev) => ({ ...prev, nationalId: e.target.value }))} />
            <Input label={t('hr.employeesPage.phone')} value={formData.phone} onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('hr.employeesPage.email')} type="email" value={formData.email} onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))} />
            <Input label={t('hr.employeesPage.address')} value={formData.address} onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('hr.employeesPage.position')} value={formData.position} onChange={(e) => setFormData((prev) => ({ ...prev, position: e.target.value }))} />
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('hr.employeesPage.department')}</label>
              <select value={formData.departmentId} onChange={(e) => setFormData((prev) => ({ ...prev, departmentId: e.target.value }))} className="form-control">
                <option value="">بدون قسم</option>
                {departments.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('hr.employeesPage.grade')} value={formData.grade} onChange={(e) => setFormData((prev) => ({ ...prev, grade: e.target.value }))} />
            <Input label={t('hr.employeesPage.baseSalary')} type="number" value={formData.baseSalary} onChange={(e) => setFormData((prev) => ({ ...prev, baseSalary: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('hr.employeesPage.hireDate')} type="date" value={formData.hireDate} onChange={(e) => setFormData((prev) => ({ ...prev, hireDate: e.target.value }))} />
            <Input
              label={t('openingBalance.title')}
              type="number"
              min={0}
              step="0.01"
              disabled={!!editing}
              value={formData.openingBalance}
              onChange={(e) => setFormData((prev) => ({ ...prev, openingBalance: e.target.value }))}
              placeholder="0.00"
              helperText={editing ? t('openingBalance.postedHint') : t('openingBalance.employeeHint')}
            />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isActive" checked={formData.isActive} onChange={(e) => setFormData((prev) => ({ ...prev, isActive: e.target.checked }))} className="rounded" />
            <label htmlFor="isActive" className="text-sm text-slate-700 dark:text-slate-200">{t('settings.common.active')}</label>
          </div>
        </div>
      </Modal>

      {/* View Modal */}
      <Modal
        isOpen={isDetailOpen}
        onClose={() => { setIsDetailOpen(false); setViewing(null); }}
        title={t('hr.employeesPage.viewTitle')}
        size="md"
        footer={<Button variant="secondary" onClick={() => { setIsDetailOpen(false); setViewing(null); }}>{t('settings.common.close')}</Button>}
      >
        {viewing && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {viewing.photoUrl ? <img src={viewing.photoUrl} alt="" className="w-16 h-16 rounded-full object-cover" /> : <div className="w-16 h-16 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center"><User size={32} className="text-slate-400" /></div>}
              <div>
                <p className="text-lg font-bold text-slate-900 dark:text-slate-50">{viewing.fullName}</p>
                <p className="text-sm text-slate-500">{viewing.position} — {viewing.departmentName || viewing.departmentId}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-2"><span className="text-slate-500">{t('hr.employeesPage.employeeNumberLabel')}</span><p className="font-medium">{viewing.employeeNumber}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-2"><span className="text-slate-500">{t('hr.employeesPage.nationalIdLabel')}</span><p className="font-medium">{viewing.nationalId || '—'}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-2"><span className="text-slate-500">{t('hr.employeesPage.phoneLabel')}</span><p className="font-medium">{viewing.phone || '—'}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-2"><span className="text-slate-500">{t('hr.employeesPage.emailLabel')}</span><p className="font-medium">{viewing.email || '—'}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-2"><span className="text-slate-500">{t('hr.employeesPage.hireDateLabel')}</span><p className="font-medium">{viewing.hireDate || '—'}</p></div>
              <div className="bg-slate-50 dark:bg-slate-800 rounded p-2"><span className="text-slate-500">{t('hr.employeesPage.baseSalaryLabel')}</span><p className="font-medium">{formatCurrency(viewing.baseSalary || 0) || '—'}</p></div>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={t('hr.employeesPage.deleteTitle')}
        message={t('hr.employeesPage.deleteConfirm')}
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
        entityLabel={t('hr.employeesPage.title')}
        exactMatch={duplicateExact}
        nearMatches={duplicateNear}
        isEdit={!!editing}
      />
    </div>
  );
};

export default EmployeesPage;
