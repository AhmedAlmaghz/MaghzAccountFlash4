import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ScanBarcode, Search, ShoppingCart, Trash2, Plus, Minus, User, LogOut,
  Printer, Pause, Play, Lock, X, Loader2,
} from 'lucide-react';
import { Button, Modal, Input, EmptyState, ToastContainer } from '@/core/ui/components';
import { CashBoxSelect, CustomerSelect } from '@/core/ui/components/smart';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useFormatters } from '@/core/utils/useFormatters';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useSettings } from '@/core/utils/useSettings';
import { useCashBoxes } from '@/core/hooks/useSettings';
import { useSessionHeartbeat } from '@/core/hooks/useSessionHeartbeat';
import { barcodeScanner } from '@/core/utils/barcodeScanner';
import { useCustomers } from '@/modules/sales/hooks/useSales';
import { logAudit } from '@/core/utils/auditLogger';
import { posApi } from '../api';
import { usePosStore, computeCartTotals } from '../store';
import { useActivePosShift, useShiftSummary } from '../hooks/usePosShifts';
import { printPosReceipt } from '../receipt';
import type { PosProduct } from '../types';

/**
 * Full-screen cashier terminal — a sibling of AppLayout (own h-dvh shell,
 * no sidebar/header). Gate: an OPEN shift. Layout: search/barcode bar on
 * top, touch product grid on the left, cart + pay on the right.
 */
export const PosTerminalPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const navigate = useNavigate();
  const activeCompany = useAppStore((s) => s.activeCompany);
  const user = useAuthStore((s) => s.user);
  const companyId = activeCompany?.id || '';
  const { formatCurrency } = useFormatters(companyId);
  const { settings } = useSettings(companyId);
  useSessionHeartbeat(true);

  const { shift, isLoading: shiftLoading, reload: reloadShift } = useActivePosShift(companyId);
  const { summary, reload: reloadSummary } = useShiftSummary(companyId, shift?.id ?? null);

  const cart = usePosStore();
  const lines = usePosStore((s) => s.lines);
  const customerId = usePosStore((s) => s.customerId);
  const customerName = usePosStore((s) => s.customerName);
  const heldCarts = usePosStore((s) => s.heldCarts);

  // Default walk-in customer for cash sales (pos.defaultWalkInCustomerId)
  const [defaultWalkInCustomerId, setDefaultWalkInCustomerId] = useState<string | null>(null);
  useEffect(() => {
    if (!companyId) { setDefaultWalkInCustomerId(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { getDbAdapter } = await import('@/core/database/adapters');
        const adapter = await getDbAdapter();
        const res = await adapter.query("SELECT value FROM settings WHERE company_id = $1 AND key = 'pos.defaultWalkInCustomerId'", [companyId]);
        if (!cancelled && res.success && res.rows?.[0]) {
          const v = String((res.rows[0] as Record<string, unknown>).value || '').trim();
          setDefaultWalkInCustomerId(v || null);
        } else if (!cancelled) {
          setDefaultWalkInCustomerId(null);
        }
      } catch { if (!cancelled) setDefaultWalkInCustomerId(null); }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  // CustomerSelect exposes id-only onChange; resolve the display name here.
  const { customers } = useCustomers(companyId);
  const customerDisplayName = customerId
    ? customers.find((c) => c.id === customerId)?.name ?? customerName ?? ''
    : defaultWalkInCustomerId
      ? customers.find((c) => c.id === defaultWalkInCustomerId)?.name ?? t('pos.walkIn')
      : null;

  // Reset the persisted cart when the active company changes
  useEffect(() => { cart.setCompany(companyId || null); }, [companyId, cart]);

  // ── Products (grid + search) ──
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [search, setSearch] = useState('');
  const [productsLoading, setProductsLoading] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadProducts = useCallback(async (q?: string) => {
    if (!companyId) return;
    setProductsLoading(true);
    const result = await posApi.getProducts(companyId, q, 200);
    if (result.success && result.data) setProducts(result.data);
    setProductsLoading(false);
  }, [companyId]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  // Debounced search — typing re-queries the catalog, clearing returns to full grid
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      loadProducts(search || undefined);
    }, 250);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, loadProducts]);

  // ── Totals (single source of truth: computeCartTotals) ──
  const vatRate = settings?.vatRate ?? 15;
  const applyVat = settings?.invoiceShowVat ?? true;
  const decimalPlaces = settings?.decimalPlaces ?? 2;
  const totals = useMemo(
    () => computeCartTotals(lines, { vatRate, applyVat, decimalPlaces }),
    [lines, vatRate, applyVat, decimalPlaces]
  );

  // ── Cart actions ──
  const addProduct = useCallback((p: PosProduct) => {
    cart.addLine({
      productId: p.id,
      nameAr: p.nameAr,
      code: p.code,
      unit: p.unit,
      quantity: 1,
      unitPrice: p.salePrice,
      discountPercent: 0,
      vatPercent: vatRate,
      stockQty: p.stockQty,
    });
  }, [cart, vatRate]);

  const handleScanOrEnter = useCallback(async (code: string) => {
    const cleaned = code.trim();
    if (!cleaned || !companyId) return;
    const found = await posApi.findProductByCode(companyId, cleaned);
    if (found.success && found.data) {
      addProduct(found.data);
      addToast('success', `${found.data.nameAr} — ${formatCurrency(found.data.salePrice)}`);
    } else {
      addToast('error', t('inventory.products.notFound', { default: 'المنتج غير موجود' }));
    }
  }, [companyId, addProduct, addToast, formatCurrency, t]);

  // Keyboard-wedge scanner (first real consumer of barcodeScanner.onScan)
  useEffect(() => {
    const unsubscribe = barcodeScanner.onScan((result) => {
      void handleScanOrEnter(result.barcode);
      setSearch('');
    });
    return unsubscribe;
  }, [handleScanOrEnter]);

  // ── Shift dialog ──
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [shiftCashBox, setShiftCashBox] = useState<string | null>(null);
  const [shiftOpening, setShiftOpening] = useState('0');
  const [isOpeningShift, setIsOpeningShift] = useState(false);
  // Preselect the first active cash box so a cashier can open a shift with one
  // click (the select stays editable for multi-box stores).
  const { boxes, isLoading: boxesLoading } = useCashBoxes(companyId);
  useEffect(() => {
    if (shiftDialogOpen && !shiftCashBox) {
      const firstActive = boxes.find((b) => b.isActive);
      if (firstActive?.id) setShiftCashBox(firstActive.id);
    }
  }, [shiftDialogOpen, shiftCashBox, boxes]);

  const handleOpenShift = async () => {
    if (!shiftCashBox || !companyId) return;
    setIsOpeningShift(true);
    const result = await posApi.openShift(companyId, shiftCashBox, Number(shiftOpening) || 0, user?.id);
    setIsOpeningShift(false);
    if (result.success) {
      addToast('success', t('pos.shiftOpened'));
      setShiftDialogOpen(false);
      reloadShift();
    } else {
      addToast('error', result.error || t('pos.checkoutFailed'));
    }
  };

  // ── Close shift dialog ──
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [countedAmount, setCountedAmount] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const handleCloseShift = async () => {
    if (!shift || !companyId) return;
    const counted = Number(countedAmount);
    if (!Number.isFinite(counted) || counted < 0) return;
    setIsClosing(true);
    const result = await posApi.closeShift(companyId, shift.id, counted, undefined, user?.id);
    setIsClosing(false);
    if (result.success) {
      addToast('success', t('pos.shiftClosed'));
      setCloseDialogOpen(false);
      cart.clearCart();
      reloadShift();
    } else {
      addToast('error', result.error || t('pos.checkoutFailed'));
    }
  };

  // ── Held carts dialog ──
  const [heldOpen, setHeldOpen] = useState(false);

  // ── Payment modal ──
  const [payOpen, setPayOpen] = useState(false);
  const [payMode, setPayMode] = useState<'cash' | 'credit' | 'mixed'>('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<{ invoiceId: string; receiptNumber: string } | null>(null);

  const openPay = useCallback(() => {
    if (lines.length === 0) return;
    if (!shift) { setShiftDialogOpen(true); return; }
    setPayMode('cash');
    setCashReceived(String(totals.totalAmount));
    setCreditAmount('0');
    setPayOpen(true);
  }, [lines.length, shift, totals.totalAmount]);

  const change = useMemo(() => {
    const received = Number(cashReceived) || 0;
    const credit = payMode === 'mixed' ? (Number(creditAmount) || 0) : payMode === 'credit' ? totals.totalAmount : 0;
    const cashPart = payMode === 'cash' ? totals.totalAmount : payMode === 'mixed' ? totals.totalAmount - credit : 0;
    return Math.max(0, received - cashPart);
  }, [cashReceived, creditAmount, payMode, totals.totalAmount]);

  // Mixed mode: when cash received is typed, auto-calculate the remaining credit (requirement)
  useEffect(() => {
    if (payMode !== 'mixed' || !payOpen) return;
    const cash = Number(cashReceived) || 0;
    // Remaining after cash is the credit (آجل)
    const autoCredit = Math.max(0, Math.min(totals.totalAmount, totals.totalAmount - cash));
    // When cash exceeds total, credit is 0 and change will be shown
    const currentCredit = Number(creditAmount) || 0;
    if (cash <= totals.totalAmount && Math.abs(autoCredit - currentCredit) > 0.01) {
      setCreditAmount(String(Math.round(autoCredit * 100) / 100));
    } else if (cash > totals.totalAmount && currentCredit !== 0) {
      setCreditAmount('0');
    }
  }, [cashReceived, payMode, payOpen, totals.totalAmount]);

  const checkingOutRef = useRef(false);
  const handleCheckout = useCallback(async () => {
    if (!shift || !companyId) return;
    if (checkingOutRef.current) return;
    const received = Number(cashReceived) || 0;
    let credit = payMode === 'credit'
      ? totals.totalAmount
      : payMode === 'mixed'
        ? (Number(creditAmount) || 0)
        : 0;
    credit = Math.max(0, Math.min(credit, totals.totalAmount));
    const requiredCash = totals.totalAmount - credit;
    if (payMode !== 'credit' && received + 0.0001 < requiredCash) {
      addToast('error', t('pos.insufficientCash', { default: `المبلغ النقدي غير كافٍ — المطلوب ${formatCurrency(requiredCash)}` }));
      return;
    }
    const cashPart = payMode === 'credit' ? 0 : requiredCash;
    const effectiveCustomerId = customerId || (credit === 0 ? defaultWalkInCustomerId : null) || null;
    if (credit > 0 && !effectiveCustomerId) {
      addToast('error', t('pos.customerRequired'));
      return;
    }
    checkingOutRef.current = true;
    setIsCheckingOut(true);
    let result: Awaited<ReturnType<typeof posApi.checkout>>;
    try {
      result = await posApi.checkout({
      companyId,
      shiftId: shift.id,
      customerId: effectiveCustomerId || '00000000-0000-0000-0000-000000000000',
      cashBoxId: shift.cashBoxId,
      lines: lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        vatPercent: l.vatPercent,
        // zod lineUnitFields are .optional() (undefined), not nullable —
        // sending null would fail validation before the transaction runs.
        unitId: l.unitId ?? undefined,
        unitFactor: l.unitFactor ?? undefined,
        baseQuantity: (l.unitFactor ?? 1) > 0 ? l.quantity * (l.unitFactor ?? 1) : undefined,
        lineTotal: Math.max(0, l.unitPrice * l.quantity * (1 - l.discountPercent / 100)),
      })),
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      vatAmount: totals.vatAmount,
      totalAmount: totals.totalAmount,
      cashAmount: cashPart,
      creditAmount: credit,
    }, user?.id);
    } finally {
      checkingOutRef.current = false;
      setIsCheckingOut(false);
    }

    if (result!.success && result!.invoiceId) {
      logAudit({
        userId: user?.id || 'unknown',
        action: 'create',
        tableName: 'sales_invoices',
        recordId: result.invoiceId,
        companyId,
        newValues: { receiptNumber: result.receiptNumber, total: totals.totalAmount, cash: cashPart, credit, isPos: true },
      });
      addToast('success', `${t('pos.saleCompleted')} — ${result.receiptNumber}`);
      setLastReceipt({ invoiceId: result.invoiceId, receiptNumber: result.receiptNumber! });
      cart.clearCart();
      setPayOpen(false);
      reloadSummary();
      // Auto-print the receipt
      const receipt = await posApi.getReceipt(companyId, result.invoiceId);
      if (receipt.success && receipt.data) {
        printPosReceipt({
          company: activeCompany,
          invoiceNumber: receipt.data.invoiceNumber,
          date: receipt.data.date,
          cashierName: user?.fullName,
          customerName: receipt.data.customerName,
          lines: receipt.data.lines,
          subtotal: receipt.data.subtotal,
          discountAmount: receipt.data.discountAmount,
          vatAmount: receipt.data.vatAmount,
          totalAmount: receipt.data.totalAmount,
          cashAmount: receipt.data.cashAmount,
          creditAmount: receipt.data.creditAmount,
          change,
          fmtCurrency: formatCurrency,
        });
      }
    } else {
      addToast('error', result.error || t('pos.checkoutFailed'));
    }
  }, [shift, companyId, payMode, cashReceived, creditAmount, totals, customerId, defaultWalkInCustomerId, lines, cart, user, activeCompany, change, formatCurrency, addToast, t, reloadSummary]);

  const reprintLast = useCallback(async () => {
    if (!lastReceipt || !companyId) return;
    const receipt = await posApi.getReceipt(companyId, lastReceipt.invoiceId);
    if (receipt.success && receipt.data) {
      printPosReceipt({
        company: activeCompany,
        invoiceNumber: receipt.data.invoiceNumber,
        date: receipt.data.date,
        cashierName: user?.fullName,
        customerName: receipt.data.customerName,
        lines: receipt.data.lines,
        subtotal: receipt.data.subtotal,
        discountAmount: receipt.data.discountAmount,
        vatAmount: receipt.data.vatAmount,
        totalAmount: receipt.data.totalAmount,
        cashAmount: receipt.data.cashAmount,
        creditAmount: receipt.data.creditAmount,
        change: 0,
        fmtCurrency: formatCurrency,
      });
    } else {
      addToast('error', receipt.error || t('pos.checkoutFailed'));
    }
  }, [lastReceipt, companyId, activeCompany, user, formatCurrency, addToast, t]);

  // ── Keyboard shortcuts (CommandPalette-style manual listener) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      if (e.key === 'F9') { e.preventDefault(); openPay(); }
      if (e.key === 'F10') { e.preventDefault(); if (lines.length) { cart.holdCart(`سلة ${new Date().toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })}`); addToast('success', t('pos.heldCarts')); } }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openPay, lines.length, cart, addToast, t]);

  const shiftDuration = useMemo(() => {
    if (!shift) return '';
    const ms = Date.now() - new Date(shift.openedAt).getTime();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}:${String(m).padStart(2, '0')}`;
  }, [shift]);

  // ── Gate: no shift → open-shift prompt ──
  if (!shiftLoading && !shift) {
    return (
      <div className="h-dvh flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4" dir="rtl">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2 font-bold text-lg">
              <ScanBarcode size={26} className="text-primary-600" />
              {t('pos.terminalTitle')}
            </div>
            <Button variant="ghost" size="sm" leftIcon={<LogOut size={16} />} onClick={() => navigate('/')}>
              {t('pos.exitTerminal')}
            </Button>
          </div>
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-soft">
            <EmptyState
              icon="inbox"
              title={t('pos.noShift')}
              description={t('pos.noShiftDesc')}
            />
            <Button variant="primary" block leftIcon={<Lock size={16} />} onClick={() => { setShiftCashBox(null); setShiftOpening('0'); setShiftDialogOpen(true); }}>
              {t('pos.openShift')}
            </Button>
          </div>
        </div>

        {shiftDialogOpen && (
          <Modal isOpen onClose={() => setShiftDialogOpen(false)} title={t('pos.openShift')} size="sm">
            <div className="space-y-4">
              {!boxesLoading && boxes.length === 0 ? (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-900/30 p-3 text-sm text-amber-700 dark:text-amber-400">
                  {t('pos.noCashBoxes')}
                  <Link to="/settings/cash-boxes" className="mt-2 block font-bold underline">
                    {t('pos.goToCashBoxes')} ←
                  </Link>
                </div>
              ) : (
                <>
                  <CashBoxSelect companyId={companyId} value={shiftCashBox ?? undefined} onChange={(v) => setShiftCashBox(v)} />
                  <Input
                    label={t('pos.openingAmount')}
                    type="number"
                    value={shiftOpening}
                    onChange={(e) => setShiftOpening(e.target.value)}
                  />
                </>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShiftDialogOpen(false)}>{t('common.cancel')}</Button>
              <Button
                variant="primary"
                isLoading={isOpeningShift}
                disabled={!shiftCashBox || (!boxesLoading && boxes.length === 0)}
                onClick={handleOpenShift}
              >
                {t('pos.openShift')}
              </Button>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  // ── Main terminal ──
  return (
    <div className="h-dvh flex flex-col bg-zinc-50 dark:bg-zinc-950 overflow-hidden" dir="rtl">
      {/* Top bar — shift status + search + customer + actions */}
      <header className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 font-bold text-primary-700 dark:text-primary-400">
            <ScanBarcode size={22} />
            <span className="hidden sm:inline">{t('pos.terminalTitle')}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {t('pos.shiftActive')} · {shift?.cashBoxName} · {shiftDuration}
          </div>

          <div className="flex-1 max-w-xl relative">
            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { void handleScanOrEnter(search); setSearch(''); } }}
              placeholder={t('pos.searchPlaceholder')}
              className="w-full min-h-11 rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 ps-9 pe-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              autoFocus
            />
          </div>

          <div className="hidden md:block w-56">
            <CustomerSelect
              companyId={companyId}
              value={customerId ?? undefined}
              onChange={(v) => cart.setCustomer(v, null)}
            />
          </div>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" leftIcon={<Pause size={16} />} onClick={() => setHeldOpen(true)} title={t('pos.heldCarts')} />
            <Button variant="ghost" size="sm" leftIcon={<Printer size={16} />} onClick={reprintLast} disabled={!lastReceipt} title={t('pos.reprint')} />
            <Button variant="outline" size="sm" leftIcon={<Lock size={16} />} onClick={() => { setCountedAmount(''); setCloseDialogOpen(true); }} title={t('pos.closeShift')} />
            <Button variant="ghost" size="sm" leftIcon={<LogOut size={16} />} onClick={() => navigate('/')} title={t('pos.exitTerminal')} />
          </div>
        </div>
      </header>

      {/* Body: product grid (main) + cart (side) */}
      <div className="flex-1 flex min-h-0">
        {/* Product grid */}
        <main className="flex-1 min-w-0 overflow-y-auto p-3">
          {productsLoading ? (
            <div className="flex items-center justify-center h-full text-zinc-400">
              <Loader2 className="animate-spin" size={28} />
            </div>
          ) : products.length === 0 ? (
            <EmptyState
              icon="search"
              title={t('common.noResults')}
              description={t('pos.search')}
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {products.map((p) => {
                const out = p.stockQty <= 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => addProduct(p)}
                    disabled={out}
                    className={`group flex flex-col justify-between rounded-xl border p-3 text-start min-h-24 transition
                      ${out
                        ? 'border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 opacity-50 cursor-not-allowed'
                        : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-primary-400 hover:shadow-lift active:scale-95'}`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="font-semibold text-sm leading-snug line-clamp-2">{p.nameAr}</span>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${out ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'}`}>
                        {out ? t('pos.outOfStock') : p.stockQty}
                      </span>
                    </div>
                    <div className="flex items-end justify-between mt-1">
                      <span className="text-[10px] text-zinc-400 font-mono">{p.code}</span>
                      <span className="font-bold text-primary-700 dark:text-primary-400 tabular-nums">{formatCurrency(p.salePrice)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </main>

        {/* Cart panel */}
        <aside className="w-full max-w-xs shrink-0 border-s border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-1.5 font-semibold text-sm">
              <ShoppingCart size={16} />
              {t('pos.cart')} ({totals.itemsCount})
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" leftIcon={<Pause size={14} />} onClick={() => cart.holdCart(`سلة ${heldCarts.length + 1}`)} disabled={lines.length === 0} title={t('pos.holdCart')} />
              <Button variant="ghost" size="sm" leftIcon={<Trash2 size={14} className="text-rose-500" />} onClick={() => cart.clearCart()} disabled={lines.length === 0} title={t('pos.clearCart')} />
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 md:hidden">
            <CustomerSelect
              companyId={companyId}
              value={customerId ?? undefined}
              onChange={(v) => cart.setCustomer(v, null)}
            />
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {lines.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <EmptyState
                  icon="inbox"
                  title={t('pos.emptyCart')}
                  description={t('pos.emptyCartDesc')}
                />
              </div>
            ) : lines.map((l) => (
              <div key={`${l.productId}::${l.unitId ?? ''}`} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{l.nameAr}</div>
                  <div className="text-xs text-zinc-500 tabular-nums">
                    {formatCurrency(l.unitPrice)} × {l.quantity} = <span className="font-semibold text-zinc-700 dark:text-zinc-300">{formatCurrency(l.unitPrice * l.quantity)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-0.5">
                  <button onClick={() => cart.setQuantity(l.productId, l.quantity - 1, l.unitId)} className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center active:scale-90"><Minus size={13} /></button>
                  <span className="w-8 text-center text-sm font-semibold tabular-nums">{l.quantity}</span>
                  <button onClick={() => cart.setQuantity(l.productId, l.quantity + 1, l.unitId)} className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center active:scale-90"><Plus size={13} /></button>
                  <button onClick={() => cart.removeLine(l.productId, l.unitId)} className="w-7 h-7 rounded-lg bg-rose-50 dark:bg-rose-900/30 text-rose-500 flex items-center justify-center active:scale-90"><X size={13} /></button>
                </div>
              </div>
            ))}
          </div>

          {/* Totals + pay */}
          <div className="border-t border-zinc-200 dark:border-zinc-800 p-3 space-y-1.5">
            {customerId && customerDisplayName && (
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <User size={12} /> {customerDisplayName}
              </div>
            )}
            <div className="flex justify-between text-xs text-zinc-500"><span>{t('pos.subtotal')}</span><span className="tabular-nums">{formatCurrency(totals.subtotal)}</span></div>
            {totals.discountAmount > 0 && <div className="flex justify-between text-xs text-rose-500"><span>{t('pos.discount')}</span><span className="tabular-nums">-{formatCurrency(totals.discountAmount)}</span></div>}
            {totals.vatAmount > 0 && <div className="flex justify-between text-xs text-zinc-500"><span>{t('pos.vat')}</span><span className="tabular-nums">{formatCurrency(totals.vatAmount)}</span></div>}
            <div className="flex justify-between items-center pt-1 border-t border-dashed border-zinc-300 dark:border-zinc-700">
              <span className="font-bold">{t('pos.total')}</span>
              <span className="font-bold text-lg text-primary-700 dark:text-primary-400 tabular-nums">{formatCurrency(totals.totalAmount)}</span>
            </div>
            <Button variant="primary" size="touch" block leftIcon={<ShoppingCart size={18} />} onClick={openPay} disabled={lines.length === 0}>
              {t('pos.pay')}
            </Button>
          </div>
        </aside>
      </div>

      {/* Payment modal */}
      <Modal isOpen={payOpen} onClose={() => setPayOpen(false)} title={t('pos.payment')} size="sm">
        <div className="space-y-4">
          <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3 flex justify-between items-center">
            <span className="text-sm text-zinc-500">{t('pos.total')}</span>
            <span className="text-xl font-bold text-primary-700 dark:text-primary-400 tabular-nums">{formatCurrency(totals.totalAmount)}</span>
          </div>

          {/* Payment mode chips */}
          <div className="grid grid-cols-3 gap-2">
            {(['cash', 'credit', 'mixed'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  setPayMode(mode);
                  if (mode === 'cash') { setCashReceived(String(totals.totalAmount)); setCreditAmount('0'); }
                  if (mode === 'credit') { setCashReceived('0'); setCreditAmount(String(totals.totalAmount)); }
                  if (mode === 'mixed') { setCashReceived(String(totals.totalAmount / 2)); setCreditAmount(String(totals.totalAmount / 2)); }
                }}
                className={`rounded-xl border py-2 text-sm font-semibold transition
                  ${payMode === mode ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400' : 'border-zinc-200 dark:border-zinc-700'}`}
              >
                {t(`pos.${mode}`)}
              </button>
            ))}
          </div>

          {payMode !== 'credit' && (
            <>
              <Input
                label={t('pos.cashReceived')}
                type="number"
                value={cashReceived}
                onChange={(e) => setCashReceived(e.target.value)}
                autoFocus
              />
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => setCashReceived(String(totals.totalAmount))} className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 text-xs font-semibold active:scale-95">{t('pos.exact')}</button>
                {[500, 1000, 5000, 10000].map((v) => (
                  <button key={v} onClick={() => setCashReceived(String(v))} className="rounded-full bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 text-xs font-semibold tabular-nums active:scale-95">{formatCurrency(v)}</button>
                ))}
              </div>
            </>
          )}

          {payMode === 'mixed' && (
            <Input
              label={t('pos.creditAmount')}
              type="number"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
            />
          )}

          {payMode !== 'cash' && !customerId && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/30 p-2.5 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <User size={14} className="shrink-0" /> {t('pos.customerRequired')}
            </div>
          )}

          {payMode !== 'credit' && (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-900/30 p-3 flex justify-between items-center">
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{t('pos.change')}</span>
              <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">{formatCurrency(change)}</span>
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPayOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            isLoading={isCheckingOut}
            disabled={payMode !== 'cash' && !customerId}
            onClick={handleCheckout}
          >
            {isCheckingOut ? t('pos.processing') : t('pos.pay')}
          </Button>
        </div>
      </Modal>

      {/* Close-shift modal */}
      <Modal isOpen={closeDialogOpen} onClose={() => setCloseDialogOpen(false)} title={t('pos.closeShiftTitle')} size="sm">
        <div className="space-y-3">
          {summary && (
            <div className="rounded-xl bg-zinc-50 dark:bg-zinc-800/50 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-zinc-500">{t('pos.cashPayments')}</span><span className="tabular-nums">{formatCurrency(summary.cashTotal)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">{t('pos.openingAmount')}</span><span className="tabular-nums">{formatCurrency(summary.openingAmount)}</span></div>
              <div className="flex justify-between font-semibold"><span>{t('pos.expectedAmount')}</span><span className="tabular-nums">{formatCurrency(summary.expectedAmount)}</span></div>
            </div>
          )}
          <Input
            label={t('pos.countedAmount')}
            type="number"
            value={countedAmount}
            onChange={(e) => setCountedAmount(e.target.value)}
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCloseDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="danger" isLoading={isClosing} onClick={handleCloseShift}>{t('pos.closeShift')}</Button>
        </div>
      </Modal>

      {/* Held carts modal */}
      <Modal isOpen={heldOpen} onClose={() => setHeldOpen(false)} title={t('pos.heldCarts')} size="sm">
        {heldCarts.length === 0 ? (
          <EmptyState icon="inbox" title={t('pos.noHeldCarts')} description="" />
        ) : (
          <div className="space-y-2">
            {heldCarts.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-800 p-2.5">
                <div className="text-sm">
                  <div className="font-medium">{h.label}</div>
                  <div className="text-xs text-zinc-500">{h.lines.length} × {t('pos.qty')}</div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="primary" leftIcon={<Play size={13} />} onClick={() => { cart.resumeCart(h.id); setHeldOpen(false); }}>
                    {t('pos.resumeCart')}
                  </Button>
                  <Button size="sm" variant="ghost" leftIcon={<Trash2 size={13} className="text-rose-500" />} onClick={() => cart.discardHeldCart(h.id)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* POS renders outside AppLayout — it needs its own toast host */}
      <ToastContainer />
    </div>
  );
};

export default PosTerminalPage;
