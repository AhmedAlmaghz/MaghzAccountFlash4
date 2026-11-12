import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save, Plus, Trash2, Send } from 'lucide-react';
import { Card, Button, Input } from '@/core/ui/components';
import { AccountSelect } from '@/core/ui/components/smart';
import { DocumentPageShell, useDocumentEditorGuard, useRestoreDraft, UnsavedChangesDialog } from '@/core/ui/components/document';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useFormatters } from '@/core/utils/useFormatters';
import { todayIso } from '@/core/utils/aging';
import { accountingApi } from '../api';

interface EntryLine {
  accountId: string;
  accountName: string;
  debit: number;
  credit: number;
}

const emptyEntry: EntryLine = { accountId: '', accountName: '', debit: 0, credit: 0 };

export const JournalEntryEditorPage: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((s) => s.activeCompany);
  const user = useAuthStore((s) => s.user);
  const companyId = activeCompany?.id || '';
  const { formatCurrency } = useFormatters(companyId);

  const isEdit = Boolean(id);
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [entries, setEntries] = useState<EntryLine[]>([emptyEntry, { ...emptyEntry }]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const [status, setStatus] = useState<string>('draft');
  const { blocked, proceed, reset, guardNavigate, clearDraft, isDirty } = useDocumentEditorGuard('journal', { date, reference, notes, entries }, loading, isEdit, saving);
  const draftSetters = useMemo(() => ({ date: setDate, reference: setReference, notes: setNotes, entries: setEntries }), []);
  useRestoreDraft('journal', isEdit, draftSetters);

  useEffect(() => {
    let cancelled = false;
    if (!id || !companyId) return;
    setLoading(true);
    (async () => {
      const res = await accountingApi.getTransactionById(id, companyId);
      if (cancelled) return;
      setLoading(false);
      if (res?.success && res.data) {
        const tx = res.data as { date?: string; reference?: string; notes?: string; status?: string; lines?: Array<{ accountId?: string; accountName?: string; debit?: number; credit?: number }> };
        setDate(tx.date ?? todayIso());
        setReference(tx.reference ?? '');
        setNotes(tx.notes ?? '');
        setStatus(tx.status ?? 'draft');
        setEntries((tx.lines ?? []).map((l) => ({ accountId: l.accountId ?? '', accountName: l.accountName ?? '', debit: l.debit ?? 0, credit: l.credit ?? 0 })));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, companyId]);

  const totals = useMemo(() => {
    const debit = entries.reduce((s, e) => s + (Number(e.debit) || 0), 0);
    const credit = entries.reduce((s, e) => s + (Number(e.credit) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) <= 0.01 && debit > 0 };
  }, [entries]);

  const updateEntry = useCallback((idx: number, patch: Partial<EntryLine>) => {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  }, []);

  const save = async (post?: boolean) => {
    if (!companyId) return;
    // Every line must reference a real account — a line with an empty
    // accountId would post an unusable entry, so refuse loudly instead.
    const missingAccount = entries.findIndex((e) => !e.accountId);
    if (missingAccount >= 0) {
      addToast('error', t('accounting.journal.accountRequired'));
      return;
    }
    if (!totals.balanced) {
      addToast('error', t('accounting.journal.unbalanced'));
      return;
    }
    setSaving(true);
    const payload = {
      // companyId is REQUIRED by the create* schema — the API validates the
      // payload exactly as it arrives and never injects the tenant, so a
      // missing companyId fails validation and the save silently does
      // nothing (no request, no error the user can act on).
      companyId,
      date,
      reference: reference || undefined,
      notes: notes || undefined,
      // The schema requires the entry total — the API never computes it.
      totalAmount: totals.debit,
      status: post ? 'posted' : 'draft',
      lines: entries.map((e) => ({ accountId: e.accountId, debit: Number(e.debit) || 0, credit: Number(e.credit) || 0 })),
    };
    const result = isEdit && id
      ? await accountingApi.updateTransaction(id, companyId, user?.id ?? '', payload as never)
      : await accountingApi.createTransaction(payload as never, user?.id ?? '');
    setSaving(false);
    if (result?.success) {
      clearDraft();
      addToast('success', t('common.saved'));
      const createdId = 'id' in result ? (result.id as string | undefined) : id;
      if (post && createdId) {
        await accountingApi.postTransaction(String(createdId), companyId, user?.id);
      }
      navigate('/accounting/journal');
    } else {
      addToast('error', result?.error || t('common.error'));
    }
  };

  const title = isEdit ? t('accounting.editJournalEntry') : t('accounting.newJournalEntry');
  const actions = (
    <>
      <Button variant="secondary" onClick={() => guardNavigate(() => navigate('/accounting/journal'))}>{t('common.cancel')}</Button>
      <Button variant="primary" leftIcon={<Save size={16} />} onClick={() => save(false)} isLoading={saving}>{t('accounting.saveDraft')}</Button>
      <Button variant="outline" leftIcon={<Send size={16} />} onClick={() => save(true)} isLoading={saving}>{t('accounting.postEntry')}</Button>
    </>
  );

  if (loading) {
    return <div className="min-h-dvh flex items-center justify-center text-sm text-zinc-500">{t('common.loading')}</div>;
  }

  return (
    <DocumentPageShell
      title={title}
      subtitle={reference}
      onBack={() => guardNavigate(() => navigate('/accounting/journal'))}
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
      summary={
        <Card className="p-4 space-y-2">
          <h3 className="font-bold text-sm">{t('accounting.journal.balance')}</h3>
          <div className="flex justify-between text-sm"><span>{t('common.debit')}</span><span className="tabular-nums font-semibold">{formatCurrency(totals.debit)}</span></div>
          <div className="flex justify-between text-sm"><span>{t('common.credit')}</span><span className="tabular-nums font-semibold">{formatCurrency(totals.credit)}</span></div>
          <div className={`rounded-lg px-3 py-2 text-xs font-bold text-center ${totals.balanced ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
            {totals.balanced ? t('accounting.journal.balanced') : `${t('accounting.journal.difference')}: ${formatCurrency(Math.abs(totals.debit - totals.credit))}`}
          </div>
        </Card>
      }
    >
      <Card className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Input label={t('common.date')} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label={t('common.reference')} value={reference} onChange={(e) => setReference(e.target.value)} />
        <Input label={t('common.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Card>

      <Card className="p-4 sm:p-5 space-y-2">
        {entries.map((entry, idx) => (
          <div key={idx} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
            <div className="sm:col-span-5">
              <label className="block text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1.5">{t('accounting.account')}</label>
              <AccountSelect
                companyId={companyId}
                value={entry.accountId || undefined}
                onChange={(v) => updateEntry(idx, { accountId: v ?? '', accountName: '' })}
                onAccountChange={(a) => updateEntry(idx, { accountId: a.id, accountName: a.nameAr })}
                selectedLabel={entry.accountName || undefined}
                placeholder={t('accounting.account')}
                size="sm"
              />
            </div>
            <div className="sm:col-span-3">
              <Input label={t('common.debit')} type="number" value={String(entry.debit)} onChange={(e) => updateEntry(idx, { debit: Number(e.target.value) || 0, credit: 0 })} className="tabular-nums" />
            </div>
            <div className="sm:col-span-3">
              <Input label={t('common.credit')} type="number" value={String(entry.credit)} onChange={(e) => updateEntry(idx, { credit: Number(e.target.value) || 0, debit: 0 })} className="tabular-nums" />
            </div>
            <button type="button" onClick={() => setEntries((prev) => prev.filter((_, i) => i !== idx))} aria-label={t('common.delete')} className="sm:col-span-1 p-2 min-h-11 min-w-11 flex items-center justify-center rounded-lg text-zinc-400 hover:text-rose-500">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" leftIcon={<Plus size={16} />} onClick={() => setEntries((prev) => [...prev, emptyEntry])} block>
          {t('common.addLine')}
        </Button>
      </Card>
      <UnsavedChangesDialog blocked={blocked} onLeave={proceed} onStay={reset} />
    </DocumentPageShell>
  );
};

export default JournalEntryEditorPage;
