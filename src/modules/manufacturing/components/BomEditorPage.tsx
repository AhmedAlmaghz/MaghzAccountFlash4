import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Save } from 'lucide-react';
import { Card, Button, Input } from '@/core/ui/components';
import { DocumentPageShell, DocumentItemsGrid, TotalsPanel, useDocumentEditorGuard, useRestoreDraft, UnsavedChangesDialog, type DocumentLine } from '@/core/ui/components/document';
import { ProductSelect } from '@/core/ui/components/smart';
import { Badge } from '@/core/ui/components/Badge';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useFormatters } from '@/core/utils/useFormatters';
import { manufacturingApi } from '../api';

const emptyLine: DocumentLine = {
  productId: '',
  productName: '',
  quantity: 1,
  unitPrice: 0,
  unitFactor: 1,
};

export const BomEditorPage: React.FC = () => {
  const { t } = useTranslation();
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((s) => s.activeCompany);
  const user = useAuthStore((s) => s.user);
  const companyId = activeCompany?.id || '';
  const { formatCurrency } = useFormatters(companyId);

  const isEdit = Boolean(id);
  const [finishedProductId, setFinishedProductId] = useState('');
  const [finishedProductName, setFinishedProductName] = useState('');
  const [outputQuantity, setOutputQuantity] = useState(1);
  const [version, setVersion] = useState('1.0');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DocumentLine[]>([emptyLine]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const { blocked, proceed, reset, guardNavigate, clearDraft } = useDocumentEditorGuard('bom', { finishedProductId, outputQuantity, version, notes, lines }, loading, isEdit, saving);
  const draftSetters = useMemo(() => ({ finishedProductId: setFinishedProductId, outputQuantity: setOutputQuantity, version: setVersion, notes: setNotes, lines: setLines }), []);
  useRestoreDraft('bom', isEdit, draftSetters);

  useEffect(() => {
    let cancelled = false;
    if (!id || !companyId) return;
    setLoading(true);
    (async () => {
      const res = await manufacturingApi.getBomById(id, companyId);
      if (cancelled) return;
      setLoading(false);
      if (res?.success && res.data) {
        // getBomById returns { bom, lines } — not a flat BOM. Reading res.data
        // directly left every field empty on edit (the old v0.28.3 behaviour).
        const { bom, lines: savedLines } = res.data;
        setFinishedProductId(bom.productId ?? '');
        setFinishedProductName(bom.productName ?? '');
        setOutputQuantity(bom.outputQuantity ?? 1);
        setVersion(bom.version || '1.0');
        setNotes(bom.notes ?? '');
        setLines(savedLines.map((l) => ({
          productId: l.materialId,
          productName: l.materialName ?? '',
          productCode: l.materialCode,
          unitName: l.materialUnit,
          quantity: l.quantity ?? 1,
          unitPrice: l.unitCost ?? 0,
          unitFactor: 1,
        })));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, companyId]);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
    return { subtotal, discountAmount: 0, vatAmount: 0, totalAmount: subtotal, itemsCount: lines.length };
  }, [lines]);

  const save = useCallback(async () => {
    if (!companyId || !finishedProductId || lines.length === 0) {
      addToast('error', t('validation.required'));
      return;
    }
    // Client-side guard: every line must resolve to a material product
    // (Phase 79 lesson: friendly named message, not the raw API error).
    if (lines.some((l) => !l.productId)) {
      addToast('error', t('validation.required'));
      return;
    }
    setSaving(true);
    const payload = {
      // companyId is REQUIRED by the create* schema — the API validates the
      // payload exactly as it arrives and never injects the tenant, so a
      // missing companyId fails validation and the save silently does
      // nothing (no request, no error the user can act on).
      companyId,
      productId: finishedProductId,
      // The schema requires a BOM version — it is now a real editable field
      // (loaded from the DB on edit) instead of a hard-coded '1.0'.
      version: version.trim() || '1.0',
      notes: notes || undefined,
      outputQuantity: outputQuantity || 1,
      // `createBomSchema.lines[].materialId` — ProductSelect sets `productId`
      // on DocumentLine (shared component) and BOM owns a material row per line.
      lines: lines.map((l) => ({ materialId: l.productId, quantity: l.quantity, unitCost: l.unitPrice })),
    };
    const result = isEdit && id
      ? await manufacturingApi.updateBom(id, companyId, user?.id, payload as never)
      : await manufacturingApi.createBom(payload as never, user?.id);
    setSaving(false);
    if (result?.success) {
      clearDraft();
      addToast('success', t('common.saved'));
      navigate('/manufacturing/bom');
    } else {
      addToast('error', result?.error || t('common.error'));
    }
  }, [companyId, finishedProductId, lines, outputQuantity, version, notes, isEdit, id, user?.id, addToast, t, navigate, clearDraft]);

  const title = isEdit ? t('manufacturing.bom.editBom') : t('manufacturing.bom.newBom');
  const actions = (
    <>
      <Button variant="secondary" onClick={() => navigate('/manufacturing/bom')}>{t('common.cancel')}</Button>
      <Button variant="primary" leftIcon={<Save size={16} />} onClick={save} isLoading={saving}>{t('common.save')}</Button>
    </>
  );

  if (loading) {
    return <div className="min-h-dvh flex items-center justify-center text-sm text-zinc-500">{t('common.loading')}</div>;
  }

  return (
    <DocumentPageShell
      title={title}
      subtitle={finishedProductName ? `${finishedProductName} — v${version}` : `v${version}`}
      onBack={() => guardNavigate(() => navigate('/manufacturing/bom'))}
      statusBadge={<Badge>{finishedProductName || t('manufacturing.bom.title')}</Badge>}
      headerActions={actions}
      footerActions={actions}
      summary={<TotalsPanel totals={totals} formatCurrency={formatCurrency} />}
    >
      <Card className="p-4 sm:p-5 space-y-4">
        <ProductSelect
          companyId={companyId}
          value={finishedProductId || undefined}
          onChange={() => undefined}
          onProductChange={(p) => {
            setFinishedProductId(p.id);
            setFinishedProductName(p.nameAr);
          }}
          manufacturingRole="finished"
          placeholder={t('manufacturing.bom.finishedProduct')}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label={t('manufacturing.form.version')} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0" />
          <Input label={t('manufacturing.bom.outputQuantity')} type="number" value={String(outputQuantity)} onChange={(e) => setOutputQuantity(Number(e.target.value) || 1)} />
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <DocumentItemsGrid companyId={companyId} lines={lines} onChange={setLines} priceType="cost" />
      </Card>

      <Card className="p-4 sm:p-5">
        <Input label={t('common.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('common.notesPlaceholder')} />
      </Card>
      <UnsavedChangesDialog blocked={blocked} onLeave={proceed} onStay={reset} />
    </DocumentPageShell>
  );
};

export default BomEditorPage;
