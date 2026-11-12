import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save } from 'lucide-react';
import { Card, Button, Input, Badge } from '@/core/ui/components';
import { DocumentPageShell, useDocumentEditorGuard, useRestoreDraft, UnsavedChangesDialog } from '@/core/ui/components/document';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { salesApi } from '../api';

export const CustomerEditorPage: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((s) => s.activeCompany);
  const user = useAuthStore((s) => s.user);
  const companyId = activeCompany?.id || '';

  const isEdit = Boolean(id);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [address, setAddress] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingDate, setOpeningDate] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const { blocked, proceed, reset, guardNavigate, clearDraft } = useDocumentEditorGuard('customer', { name, phone, email, taxNumber, address, openingBalance, openingDate, isActive }, loading, isEdit, saving);
  const draftSetters = useMemo(() => ({ name: setName, phone: setPhone, email: setEmail, taxNumber: setTaxNumber, address: setAddress, openingBalance: setOpeningBalance, openingDate: setOpeningDate, isActive: setIsActive }), []);
  useRestoreDraft('customer', isEdit, draftSetters);

  useEffect(() => {
    let cancelled = false;
    if (!id || !companyId) return;
    setLoading(true);
    (async () => {
      const res = await salesApi.getCustomerById(id, companyId);
      if (cancelled) return;
      setLoading(false);
      if (res?.success && res.data) {
        const c = res.data;
        setName(c.name ?? '');
        setPhone(c.phone ?? '');
        setEmail(c.email ?? '');
        setTaxNumber(c.taxNumber ?? '');
        setAddress(c.address ?? '');
        setOpeningBalance(c.openingBalance != null ? String(c.openingBalance) : '');
        setOpeningDate(c.openingDate ? String(c.openingDate).slice(0, 10) : '');
        setIsActive(c.isActive !== false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, companyId]);

  const save = useCallback(async () => {
    if (!companyId || !name.trim()) {
      addToast('error', t('validation.required'));
      return;
    }
    setSaving(true);
    const payload = {
      // createCustomerSchema requires the tenant — the create path validates
      // the WHOLE payload, so a missing companyId fails validation silently
      // (no request is ever made and the user sees nothing happen).
      companyId,
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      taxNumber: taxNumber.trim() || undefined,
      address: address.trim() || undefined,
      openingBalance: openingBalance === '' ? undefined : Number(openingBalance) || 0,
      openingDate: openingDate || undefined,
      isActive,
    };
    const result = isEdit && id
      ? await salesApi.updateCustomer(id, companyId, payload as never, user?.id)
      : await salesApi.createCustomer(payload as never, user?.id);
    setSaving(false);
    if (result?.success) {
      clearDraft();
      addToast('success', t('common.saved'));
      navigate('/sales/customers');
    } else {
      addToast('error', result?.error || t('common.error'));
    }
  }, [companyId, name, phone, email, taxNumber, address, openingBalance, openingDate, isActive, isEdit, id, user?.id, addToast, t, navigate, clearDraft]);

  const title = isEdit ? t('sales.customer.edit') : t('sales.customer.new');
  const actions = (
    <>
      <Button variant="secondary" onClick={() => navigate('/sales/customers')}>{t('common.cancel')}</Button>
      <Button variant="primary" leftIcon={<Save size={16} />} onClick={save} isLoading={saving}>{t('common.save')}</Button>
    </>
  );

  if (loading) {
    return <div className="min-h-dvh flex items-center justify-center text-sm text-zinc-500">{t('common.loading')}</div>;
  }

  return (
    <DocumentPageShell title={title} onBack={() => guardNavigate(() => navigate('/sales/customers'))} statusBadge={<Badge>{isActive ? t('common.enabled') : t('common.disabled')}</Badge>} headerActions={actions} footerActions={actions} summary={<Card className="p-4 text-sm space-y-2"><h3 className="font-bold">{t('sales.customer.title')}</h3><p className="text-zinc-500">{name || '-'}</p></Card>}>
      <Card className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label={t('common.phone')} value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Input label={t('common.email')} value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label={t('sales.customer.taxNumber')} value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
        <Input label={t('common.address')} value={address} onChange={(e) => setAddress(e.target.value)} className="sm:col-span-2" />
        <Input label={t('openingBalance.title')} type="number" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} disabled={isEdit} />
        <Input label={t('common.date')} type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} disabled={isEdit} />
      </Card>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="rounded" />
        {t('common.enabled')}
      </label>
      <UnsavedChangesDialog blocked={blocked} onLeave={proceed} onStay={reset} />
    </DocumentPageShell>
  );
};

export default CustomerEditorPage;

