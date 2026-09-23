import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Save, Wifi, WifiOff, Loader2, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAppStore } from '@/core/store';
import { usePermission } from '@/modules/auth/hooks/usePermission';
import { aiApi } from '../api';
import { PROVIDER_PRESETS } from '../api/providers';
import type { AiPublicConfig } from '../types';
import { getJevConfig, setJevSetting, JEV_DEFAULT_MODEL, JEV_SETTINGS_KEYS } from '../jev/jevConfig';
import { jevHealthCheck } from '../jev/jevClient';
import { getJevMetricsSummary, getLastJevRoute, getLastJevError, subscribeJevMetrics } from '../jev/jevMetrics';
import { Button } from '@/core/ui/components/Button';
import { Card, CardTitle, CardDescription } from '@/core/ui/components/Card';
import { Input } from '@/core/ui/components/Input';
import { useToastStore } from '@/core/store/toastStore';
import { cn } from '@/core/utils';

const PROVIDERS = PROVIDER_PRESETS.map((p) => ({ id: p.id, label: `ai.settings.presets.${p.id}`, baseUrl: p.baseUrl }));

export default function AiSettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const company = useAppStore((s) => s.activeCompany);
  const canConfigure = usePermission('ai.settings');
  const addToast = useToastStore((s) => s.addToast);

  const [config, setConfig] = useState<AiPublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [showKey, setShowKey] = useState(false);
  // Browser/PGlite mode stores the API key UNENCRYPTED in the local settings
  // table (no OS safeStorage outside Electron) — warn the user explicitly.
  const isBrowserMode = typeof window !== 'undefined' && !(window as { electronAI?: unknown }).electronAI;

  // Form state
  const [provider, setProvider] = useState('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(true);
  // P1-1 browser hardening: desktop-only kill-switch + key revocation.
  const [browserDisabled, setBrowserDisabled] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeArmed, setRevokeArmed] = useState(false);
  // B2 session token budget (0/empty = unlimited).
  const [tokenBudget, setTokenBudget] = useState('');
  // B3 fallback route (tried once on transient primary failure).
  const [fbProvider, setFbProvider] = useState('openai');
  const [fbBaseUrl, setFbBaseUrl] = useState('');
  const [fbModel, setFbModel] = useState('');
  const [fbApiKey, setFbApiKey] = useState('');
  const [testingFb, setTestingFb] = useState(false);
  const [fbTestResult, setFbTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [fbRevokeArmed, setFbRevokeArmed] = useState(false);
  const [revokingFb, setRevokingFb] = useState(false);

  // JEV — System One
  const [jevEnabled, setJevEnabled] = useState(false);
  const [jevApiKey, setJevApiKey] = useState('');
  const [jevModel, setJevModel] = useState(JEV_DEFAULT_MODEL);
  const [jevRouterEnabled, setJevRouterEnabled] = useState(true);
  const [jevGuardEnabled, setJevGuardEnabled] = useState(false);
  const [jevHasKey, setJevHasKey] = useState(false);
  const [jevMaskedKey, setJevMaskedKey] = useState<string | null>(null);
  const [jevTesting, setJevTesting] = useState(false);
  const [jevTestResult, setJevTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [jevSaving, setJevSaving] = useState(false);
  const [jevMetricsTick, setJevMetricsTick] = useState(0);

  // Load config
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!company?.id) { setLoading(false); return; }
      const res = await aiApi.getConfig(company.id);
      if (cancelled) return;
      if (res.success && res.data) {
        setConfig(res.data);
        setProvider(res.data.provider || 'gemini');
        setBaseUrl(res.data.baseUrl || '');
        setModel(res.data.model || '');
        setEnabled(res.data.enabled);
        setBrowserDisabled(res.data.browserDisabled);
        setTokenBudget(res.data.tokenBudget && res.data.tokenBudget > 0 ? String(res.data.tokenBudget) : '');
        setFbProvider(res.data.fallbackProvider || 'openai');
        setFbBaseUrl(res.data.fallbackBaseUrl || '');
        setFbModel(res.data.fallbackModel || '');
      }
      // JEV config — per-company
      try {
        const jev = await getJevConfig(company.id);
        if (cancelled) return;
        setJevEnabled(jev.enabled);
        setJevModel(jev.model || JEV_DEFAULT_MODEL);
        setJevRouterEnabled(jev.routerEnabled);
        setJevGuardEnabled(jev.guardEnabled);
        setJevHasKey(!!jev.apiKey);
        setJevMaskedKey(jev.apiKey ? `${jev.apiKey.slice(0, 6)}****${jev.apiKey.slice(-4)}` : null);
      } catch { /* ignore */ }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [company?.id]);

  // P0: live JEV metrics — re-render the card on every recorded call,
  // not only after save. Subscription is module-local (in-memory metrics).
  useEffect(() => subscribeJevMetrics(() => setJevMetricsTick((x) => x + 1)), []);

  const handleProviderChange = useCallback((id: string) => {
    setProvider(id);
    const preset = PROVIDERS.find((p) => p.id === id);
    if (preset && preset.baseUrl) {
      setBaseUrl(preset.baseUrl);
    }
  }, []);

  const handleFbProviderChange = useCallback((id: string) => {
    setFbProvider(id);
    const preset = PROVIDERS.find((p) => p.id === id);
    if (preset && preset.baseUrl) {
      setFbBaseUrl(preset.baseUrl);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!company?.id) return;
    setSaving(true);
    try {
      const budgetRaw = tokenBudget.trim();
      const res = await aiApi.saveConfig({
        companyId: company.id,
        provider,
        baseUrl,
        model,
        apiKey: apiKey || undefined,
        enabled,
        browserDisabled,
        // Empty = unlimited (bridge stores '0'); invalid text is rejected
        // by the bridge with an honest error, never silently coerced.
        tokenBudget: budgetRaw === '' ? 0 : Number(budgetRaw),
        fallbackProvider: fbProvider,
        fallbackBaseUrl: fbBaseUrl || undefined,
        fallbackModel: fbModel || undefined,
        fallbackApiKey: fbApiKey || undefined,
      });
      if (res.success) {
        addToast('success', t('ai.settings.saved'));
        // Refresh config to get updated masked key
        const fresh = await aiApi.getConfig(company.id);
        if (fresh.success && fresh.data) {
          setConfig(fresh.data);
          setBrowserDisabled(fresh.data.browserDisabled);
          setTokenBudget(fresh.data.tokenBudget && fresh.data.tokenBudget > 0 ? String(fresh.data.tokenBudget) : '');
          setFbApiKey('');
        }
      } else {
        addToast('error', res.error || t('ai.errors.generic'));
      }
    } catch (err) {
      // Previously escaped with only `finally` — a thrown IPC error left the
      // user with no feedback at all.
      addToast('error', err instanceof Error ? err.message : t('ai.errors.generic'));
    } finally {
      setSaving(false);
    }
  }, [company?.id, provider, baseUrl, model, apiKey, enabled, browserDisabled, tokenBudget, fbProvider, fbBaseUrl, fbModel, fbApiKey, addToast, t]);

  const handleRevoke = useCallback(async () => {
    if (!company?.id) return;
    if (!revokeArmed) {
      setRevokeArmed(true);
      return;
    }
    setRevoking(true);
    try {
      const res = await aiApi.saveConfig({ companyId: company.id, revokeKey: true });
      if (res.success) {
        addToast('success', t('ai.settings.revoked'));
        setRevokeArmed(false);
        const fresh = await aiApi.getConfig(company.id);
        if (fresh.success && fresh.data) setConfig(fresh.data);
      } else {
        addToast('error', res.error || t('ai.settings.revokeFailed'));
      }
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('ai.settings.revokeFailed'));
    } finally {
      setRevoking(false);
    }
  }, [company?.id, revokeArmed, addToast, t]);

  const handleTest = useCallback(async () => {
    if (!company?.id) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await aiApi.testConnection({
        companyId: company.id,
        baseUrl,
        model,
        apiKey: apiKey || undefined,
      });
      if (res.success && res.data) {
        setTestResult({ ok: true, message: `${t('ai.settings.testSuccess')} — ${res.data.model}` });
      } else {
        setTestResult({ ok: false, message: res.error || t('ai.settings.testFailed') });
      }
    } catch {
      setTestResult({ ok: false, message: t('ai.settings.testFailed') });
    } finally {
      setTesting(false);
    }
  }, [company?.id, baseUrl, model, apiKey, t]);

  const handleTestFb = useCallback(async () => {
    if (!company?.id) return;
    setTestingFb(true);
    setFbTestResult(null);
    try {
      // testConnection accepts explicit credentials — no bridge change
      // needed to probe the fallback route.
      const res = await aiApi.testConnection({
        companyId: company.id,
        baseUrl: fbBaseUrl || undefined,
        model: fbModel || undefined,
        apiKey: fbApiKey || undefined,
      });
      if (res.success && res.data) {
        setFbTestResult({ ok: true, message: `${t('ai.settings.testSuccess')} — ${res.data.model}` });
      } else {
        setFbTestResult({ ok: false, message: res.error || t('ai.settings.testFailed') });
      }
    } catch {
      setFbTestResult({ ok: false, message: t('ai.settings.testFailed') });
    } finally {
      setTestingFb(false);
    }
  }, [company?.id, fbBaseUrl, fbModel, fbApiKey, t]);

  const handleRevokeFb = useCallback(async () => {
    if (!company?.id) return;
    if (!fbRevokeArmed) {
      setFbRevokeArmed(true);
      return;
    }
    setRevokingFb(true);
    try {
      const res = await aiApi.saveConfig({ companyId: company.id, revokeFallbackKey: true });
      if (res.success) {
        addToast('success', t('ai.settings.revoked'));
        setFbRevokeArmed(false);
        const fresh = await aiApi.getConfig(company.id);
        if (fresh.success && fresh.data) setConfig(fresh.data);
      } else {
        addToast('error', res.error || t('ai.settings.revokeFailed'));
      }
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('ai.settings.revokeFailed'));
    } finally {
      setRevokingFb(false);
    }
  }, [company?.id, fbRevokeArmed, addToast, t]);

  const handleJevSave = useCallback(async () => {
    if (!company?.id) return;
    setJevSaving(true);
    try {
      const ops: Promise<{ success: boolean; error?: string }>[] = [];
      ops.push(setJevSetting(company.id, JEV_SETTINGS_KEYS.enabled, jevEnabled ? 'true' : 'false'));
      ops.push(setJevSetting(company.id, JEV_SETTINGS_KEYS.routerEnabled, jevRouterEnabled ? 'true' : 'false'));
      ops.push(setJevSetting(company.id, JEV_SETTINGS_KEYS.guardEnabled, jevGuardEnabled ? 'true' : 'false'));
      ops.push(setJevSetting(company.id, JEV_SETTINGS_KEYS.model, jevModel || JEV_DEFAULT_MODEL));
      if (jevApiKey.trim()) {
        ops.push(setJevSetting(company.id, JEV_SETTINGS_KEYS.apiKey, jevApiKey.trim()));
      }
      const results = await Promise.all(ops);
      const failed = results.find((r) => !r.success);
      if (failed) {
        addToast('error', failed.error || t('ai.errors.generic'));
      } else {
        addToast('success', t('ai.settings.saved'));
        setJevApiKey('');
        // refresh masked
        const jev = await getJevConfig(company.id);
        setJevHasKey(!!jev.apiKey);
        setJevMaskedKey(jev.apiKey ? `${jev.apiKey.slice(0, 6)}****${jev.apiKey.slice(-4)}` : null);
        setJevMetricsTick((x) => x + 1);
      }
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('ai.errors.generic'));
    } finally {
      setJevSaving(false);
    }
  }, [company?.id, jevEnabled, jevRouterEnabled, jevGuardEnabled, jevModel, jevApiKey, addToast, t]);

  const handleJevTest = useCallback(async () => {
    if (!company?.id) return;
    setJevTesting(true);
    setJevTestResult(null);
    try {
      // If user typed a new key but didn't save yet, test with that key transiently
      // by saving it temporarily? For now test with stored key.
      if (jevApiKey.trim()) {
        // Quick inline test with typed key without persisting
        const { TypeSafeClient } = await import('@typesafe-ai/sdk');
        const c = new TypeSafeClient({ apiKey: jevApiKey.trim(), timeout: 6000, dangerouslyAllowBrowser: true });
        const start = Date.now();
        const res = await c.systemOne({
          state: 'ping',
          questions: { ping: { type: 'noul', instructions: 'Is the state exactly "ping"?' } },
        });
        const ms = Date.now() - start;
        setJevTestResult({ ok: true, message: `${t('ai.settings.jevTestSuccess')} — ${res.model} ${ms}ms` });
      } else {
        const res = await jevHealthCheck(company.id);
        if (res.ok) setJevTestResult({ ok: true, message: `${t('ai.settings.jevTestSuccess')} — ${res.model} ${res.latencyMs}ms` });
        else setJevTestResult({ ok: false, message: res.error || t('ai.settings.jevTestFailed') });
      }
    } catch (err) {
      setJevTestResult({ ok: false, message: err instanceof Error ? err.message : t('ai.settings.jevTestFailed') });
    } finally {
      setJevTesting(false);
    }
  }, [company?.id, jevApiKey, t]);

  const handleJevRevoke = useCallback(async () => {
    if (!company?.id) return;
    const res = await setJevSetting(company.id, JEV_SETTINGS_KEYS.apiKey, null);
    if (res.success) {
      addToast('success', t('ai.settings.revoked'));
      setJevHasKey(false);
      setJevMaskedKey(null);
    } else addToast('error', res.error || t('ai.settings.revokeFailed'));
  }, [company?.id, addToast, t]);

  // P0 diagnostics: one click answers "is JEV actually driving the chat?"
  // Reads live config + in-memory route evidence — no network call.
  const [jevDiag, setJevDiag] = useState<string | null>(null);
  const handleJevDiagnose = useCallback(async () => {
    if (!company?.id) return;
    setJevDiag(t('ai.settings.jevDiagnosing'));
    try {
      const cfg = await getJevConfig(company.id);
      const last = getLastJevRoute();
      const lastErr = getLastJevError();
      const s = getJevMetricsSummary();
      const lines: string[] = [];
      lines.push(cfg.enabled ? '✓ التفعيل: يعمل' : '✗ التفعيل: مطفأ (ai.jev_enabled)');
      lines.push(cfg.apiKey ? `✓ المفتاح: محفوظ (${cfg.apiKey.slice(0, 4)}****)` : '✗ المفتاح: غير موجود — الصقه واحفظ');
      lines.push(cfg.routerEnabled ? '✓ الموجّه: مفعّل' : '○ الموجّه: مطفأ — سيُستخدم مطابقة الكلمات');
      lines.push(cfg.guardEnabled ? '✓ الحراسة: مفعّلة' : '○ الحراسة: مطفأة');
      lines.push(`النموذج: ${cfg.model}`);
      if (lastErr) lines.push(`❌ آخر خطأ JEV [${lastErr.label}]: ${lastErr.error}`);
      if (last) lines.push(`⚡ آخر توجيه: ${last.intent} · ثقة ${(last.confidence * 100).toFixed(0)}% · ${last.latencyMs}ms`);
      else lines.push('○ لم يوجَّه أي طلب عبر JEV بعد في هذه الجلسة — أرسل رسالة في الدردشة ثم أعد الفحص');
      lines.push(`المقاييس: ${s.totalCalls} استدعاء (JEV ${s.jevCalls} / احتياطي ${s.fallbackCalls}) · التكلفة $${s.totalCostUsd.toFixed(6)}`);
      const driving = cfg.enabled && !!cfg.apiKey && !!last;
      lines.push(driving ? `✅ ${t('ai.settings.jevDiagOn')}` : `⚠️ ${t('ai.settings.jevDiagOff')}`);
      setJevDiag(lines.join('\n'));
    } catch (e) {
      setJevDiag(e instanceof Error ? e.message : String(e));
    }
  }, [company?.id, t]);

  if (!canConfigure) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
        {t('ai.noPermission')}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary-600 dark:text-primary-400" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2.5 rounded-xl text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label={t('common.back')}
        >
          <ArrowRight size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">{t('ai.settings.title')}</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('ai.settings.subtitle')}</p>
        </div>
      </div>

      {/* Provider Presets */}
      <Card>
        <CardTitle>{t('ai.settings.provider')}</CardTitle>
        <CardDescription>{t('ai.settings.subtitle')}</CardDescription>
        <div className="mt-4 grid grid-cols-3 sm:grid-cols-5 gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleProviderChange(p.id)}
              className={cn(
                'px-3 py-2.5 min-h-10 text-xs font-semibold rounded-xl border transition-all active:scale-95',
                provider === p.id
                  ? 'bg-primary-50 dark:bg-primary-950/50 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 shadow-card'
                  : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-primary-200 dark:hover:border-primary-800'
              )}
            >
              {t(p.label)}
            </button>
          ))}
        </div>
      </Card>

      {/* Configuration */}
      <Card>
        <div className="space-y-4">
          {/* Base URL */}
          <Input
            label={t('ai.settings.baseUrl')}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={PROVIDERS.find((p) => p.id === provider)?.baseUrl || 'https://...'}
          />

          {/* Model */}
          <Input
            label={t('ai.settings.model')}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o, claude-3.5-sonnet, ..."
          />

          {/* API Key */}
          <div className="relative">
            <Input
              label={t('ai.settings.apiKey')}
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('ai.settings.apiKeyPlaceholder')}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="pointer-events-auto cursor-pointer text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                  aria-label={showKey ? t('ai.settings.hideApiKey') : t('ai.settings.showApiKey')}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
            />
            {/* Current key status */}
            {config?.hasApiKey && !apiKey && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {config.keySource === 'env'
                  ? t('ai.settings.apiKeyEnv')
                  : t('ai.settings.apiKeySet', { key: config.maskedKey || '****' })}
              </p>
            )}
          </div>

          {/* Enabled toggle */}
          <label
            className="flex items-center gap-3 cursor-pointer select-none"
            onClick={(e) => {
              e.preventDefault();
              setEnabled(!enabled);
            }}
          >
            <div
              role="switch"
              aria-checked={enabled}
              className={cn(
                'relative w-11 h-6 rounded-full transition-colors shrink-0',
                enabled ? 'bg-primary-600' : 'bg-zinc-300 dark:bg-zinc-700'
              )}
            >
              <div
                className={cn(
                  'absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all',
                  enabled ? 'start-6' : 'start-1'
                )}
              />
            </div>
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('ai.settings.enabled')}</span>
          </label>

          {/* Session token budget (B2) */}
          <div>
            <Input
              label={t('ai.settings.tokenBudget')}
              type="number"
              min={0}
              step={1000}
              value={tokenBudget}
              onChange={(e) => setTokenBudget(e.target.value)}
              placeholder={t('ai.settings.tokenBudgetPlaceholder')}
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t('ai.settings.tokenBudgetHint')}
            </p>
          </div>

          {/* Security note */}
          <p className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 leading-relaxed">
            🔒 {t('ai.settings.securityNote')}
          </p>
          {/* Browser-mode warning: no OS keychain encryption outside Electron */}
          {isBrowserMode && (
            <>
              <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/40 rounded-xl p-3 leading-relaxed">
                ⚠️ {t('ai.settings.browserKeyWarning')}
              </p>
              {config?.keyStorage === 'encrypted-device' && (
                <p className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/40 rounded-xl p-3 leading-relaxed">
                  🔒 {t('ai.settings.browserEncryptedNote')}
                </p>
              )}
              {config?.keyStorage === 'plaintext-legacy' && (
                <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-300 dark:border-amber-500/40 rounded-xl p-3 leading-relaxed">
                  ⚠️ {t('ai.settings.browserLegacyKeyNote')}
                </p>
              )}
              {/* Desktop-only kill-switch for shared machines (browser only —
                  meaningless in Electron, where traffic never leaves the app) */}
              <label
                className="flex items-start gap-3 cursor-pointer select-none"
                onClick={(e) => {
                  e.preventDefault();
                  setBrowserDisabled(!browserDisabled);
                }}
              >
                <div
                  role="switch"
                  aria-checked={browserDisabled}
                  className={cn(
                    'relative w-11 h-6 rounded-full transition-colors shrink-0 mt-0.5',
                    browserDisabled ? 'bg-primary-600' : 'bg-zinc-300 dark:bg-zinc-700'
                  )}
                >
                  <div
                    className={cn(
                      'absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all',
                      browserDisabled ? 'start-6' : 'start-1'
                    )}
                  />
                </div>
                <span>
                  <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('ai.settings.serverOnlyMode')}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{t('ai.settings.serverOnlyModeHint')}</span>
                </span>
              </label>
            </>
          )}
          {/* Key revocation (two-click confirm) — works in BOTH modes whenever
              a company key is stored (browser vault row / Electron safeStorage
              row); env-provided keys are read-only and hide this control. */}
          {config?.hasApiKey && config?.keySource === 'db' && (
            <Button
              variant="outline"
              onClick={handleRevoke}
              isLoading={revoking}
            >
              {revokeArmed ? t('ai.settings.revokeKeyConfirm') : t('ai.settings.revokeKey')}
            </Button>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3 mt-6 pt-4 border-t border-zinc-200/70 dark:border-zinc-800">
          <Button
            variant="primary"
            onClick={handleSave}
            isLoading={saving}
            leftIcon={<Save size={16} />}
          >
            {t('ai.settings.save')}
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            isLoading={testing}
            leftIcon={testing ? undefined : <Wifi size={16} />}
          >
            {testing ? t('ai.settings.testing') : t('ai.settings.testConnection')}
          </Button>
        </div>

        {/* Test result */}
        {testResult && (
          <div
            className={cn(
              'mt-3 px-4 py-2.5 rounded-xl text-sm',
              testResult.ok
                ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-300 border border-success-200 dark:border-success-800'
                : 'bg-danger-50 dark:bg-danger-900/20 text-danger-700 dark:text-danger-300 border border-danger-200 dark:border-danger-800'
            )}
          >
            {testResult.ok ? <Wifi size={14} className="inline ms-1 -mt-0.5" /> : <WifiOff size={14} className="inline ms-1 -mt-0.5" />}
            {testResult.message}
          </div>
        )}
      </Card>

      {/* JEV — System One (TypeSafe) */}
      <Card>
        <CardTitle>{t('ai.settings.jevTitle')}</CardTitle>
        <CardDescription>{t('ai.settings.jevSubtitle')}</CardDescription>
        <div className="space-y-4 mt-4">
          <label className="flex items-center gap-3 cursor-pointer select-none" onClick={(e) => { e.preventDefault(); setJevEnabled(!jevEnabled); }}>
            <div role="switch" aria-checked={jevEnabled} className={cn('relative w-11 h-6 rounded-full transition-colors shrink-0', jevEnabled ? 'bg-primary-600' : 'bg-zinc-300 dark:bg-zinc-700')}>
              <div className={cn('absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all', jevEnabled ? 'start-6' : 'start-1')} />
            </div>
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('ai.settings.jevEnabled')}</span>
          </label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 -mt-2 ms-14">{t('ai.settings.jevEnabledHint')}</p>

          <div className="relative">
            <Input
              label={t('ai.settings.jevApiKey')}
              type={showKey ? 'text' : 'password'}
              value={jevApiKey}
              onChange={(e) => setJevApiKey(e.target.value)}
              placeholder={t('ai.settings.jevApiKeyPlaceholder')}
              rightIcon={
                <button type="button" onClick={() => setShowKey(!showKey)} className="pointer-events-auto cursor-pointer text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors" aria-label={showKey ? t('ai.settings.hideApiKey') : t('ai.settings.showApiKey')}>
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
            />
            {jevHasKey && !jevApiKey && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('ai.settings.apiKeySet', { key: jevMaskedKey || '****' })}</p>
            )}
          </div>

          <Input label={t('ai.settings.jevModel')} value={jevModel} onChange={(e) => setJevModel(e.target.value)} placeholder={t('ai.settings.jevModelPlaceholder')} />

          <label className="flex items-center gap-3 cursor-pointer select-none" onClick={(e) => { e.preventDefault(); setJevRouterEnabled(!jevRouterEnabled); }}>
            <div role="switch" aria-checked={jevRouterEnabled} className={cn('relative w-11 h-6 rounded-full transition-colors shrink-0', jevRouterEnabled ? 'bg-primary-600' : 'bg-zinc-300 dark:bg-zinc-700')}>
              <div className={cn('absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all', jevRouterEnabled ? 'start-6' : 'start-1')} />
            </div>
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('ai.settings.jevRouterEnabled')}</span>
          </label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 -mt-2 ms-14">{t('ai.settings.jevRouterHint')}</p>

          <label className="flex items-center gap-3 cursor-pointer select-none" onClick={(e) => { e.preventDefault(); setJevGuardEnabled(!jevGuardEnabled); }}>
            <div role="switch" aria-checked={jevGuardEnabled} className={cn('relative w-11 h-6 rounded-full transition-colors shrink-0', jevGuardEnabled ? 'bg-primary-600' : 'bg-zinc-300 dark:bg-zinc-700')}>
              <div className={cn('absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all', jevGuardEnabled ? 'start-6' : 'start-1')} />
            </div>
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('ai.settings.jevGuardEnabled')}</span>
          </label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 -mt-2 ms-14">{t('ai.settings.jevGuardHint')}</p>

          {jevHasKey && (
            <Button variant="outline" onClick={handleJevRevoke}>{t('ai.settings.revokeKey')}</Button>
          )}

          {/* Metrics */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-3 bg-zinc-50 dark:bg-zinc-800/50">
            <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{t('ai.settings.jevMetricsTitle')}</div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{t('ai.settings.jevMetricsHint')}</p>
            {(() => {
              void jevMetricsTick;
              const s = getJevMetricsSummary();
              const last = getLastJevRoute();
              return (
                <>
                  {s.totalCalls === 0
                    ? <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">{t('ai.settings.jevNoMetrics')}</p>
                    : (
                      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div><span className="text-zinc-500">calls</span><div className="font-mono font-semibold">{s.totalCalls} (jev {s.jevCalls})</div></div>
                        <div><span className="text-zinc-500">avg</span><div className="font-mono font-semibold">{s.avgLatencyMs != null ? `${s.avgLatencyMs.toFixed(0)}ms` : '—'}</div></div>
                        <div><span className="text-zinc-500">p95</span><div className="font-mono font-semibold">{s.p95LatencyMs != null ? `${s.p95LatencyMs.toFixed(0)}ms` : '—'}</div></div>
                        <div><span className="text-zinc-500">cost</span><div className="font-mono font-semibold">${s.totalCostUsd.toFixed(6)}</div></div>
                      </div>
                    )}
                  {/* P0 diagnostics: last routed intent — proves JEV is (or isn't) driving the chat */}
                  <div className="mt-2 text-xs rounded-lg px-3 py-2 border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900">
                    {last
                      ? <span>⚡JEV <span className="font-mono font-semibold">{last.intent}</span> · ثقة <span className="font-mono font-semibold">{(last.confidence * 100).toFixed(0)}%</span> · <span className="font-mono">{last.latencyMs}ms</span></span>
                      : <span className="text-zinc-500 dark:text-zinc-400">{t('ai.settings.jevNoRoute')}</span>}
                    {!jevEnabled && <span className="block mt-1 text-amber-600 dark:text-amber-400">{t('ai.settings.jevDisabledHint')}</span>}
                    {jevEnabled && !jevHasKey && <span className="block mt-1 text-amber-600 dark:text-amber-400">{t('ai.settings.jevNoKeyHint')}</span>}
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mt-6 pt-4 border-t border-zinc-200/70 dark:border-zinc-800">
          <Button variant="primary" onClick={handleJevSave} isLoading={jevSaving} leftIcon={<Save size={16} />}>{t('ai.settings.save')}</Button>
          <Button variant="outline" onClick={handleJevTest} isLoading={jevTesting} leftIcon={jevTesting ? undefined : <Wifi size={16} />}>{jevTesting ? t('ai.settings.jevTesting') : t('ai.settings.jevTest')}</Button>
          <Button variant="outline" onClick={handleJevDiagnose}>{t('ai.settings.jevDiagnose')}</Button>
        </div>
        {jevDiag && (
          <div className="mt-3 px-4 py-2.5 rounded-xl text-xs font-mono whitespace-pre-line leading-relaxed bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">
            {jevDiag}
          </div>
        )}
        {jevTestResult && (
          <div className={cn('mt-3 px-4 py-2.5 rounded-xl text-sm', jevTestResult.ok ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-300 border border-success-200 dark:border-success-800' : 'bg-danger-50 dark:bg-danger-900/20 text-danger-700 dark:text-danger-300 border border-danger-200 dark:border-danger-800')}>
            {jevTestResult.ok ? <Wifi size={14} className="inline ms-1 -mt-0.5" /> : <WifiOff size={14} className="inline ms-1 -mt-0.5" />}{jevTestResult.message}
          </div>
        )}
      </Card>

      {/* Fallback provider (B3) — tried ONCE when the primary fails
          transiently (429/503/529/timeout). Saved with the main form above;
          tested independently below. */}
      <Card>
        <CardTitle>{t('ai.settings.fallbackTitle')}</CardTitle>
        <CardDescription>{t('ai.settings.fallbackSubtitle')}</CardDescription>
        <div className="mt-4 grid grid-cols-3 sm:grid-cols-5 gap-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleFbProviderChange(p.id)}
              className={cn(
                'px-3 py-2.5 min-h-10 text-xs font-semibold rounded-xl border transition-all active:scale-95',
                fbProvider === p.id
                  ? 'bg-primary-50 dark:bg-primary-950/50 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 shadow-card'
                  : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-primary-200 dark:hover:border-primary-800'
              )}
            >
              {t(p.label)}
            </button>
          ))}
        </div>
        <div className="space-y-4 mt-4">
          <Input
            label={t('ai.settings.baseUrl')}
            value={fbBaseUrl}
            onChange={(e) => setFbBaseUrl(e.target.value)}
            placeholder={PROVIDERS.find((p) => p.id === fbProvider)?.baseUrl || 'https://...'}
          />
          <Input
            label={t('ai.settings.model')}
            value={fbModel}
            onChange={(e) => setFbModel(e.target.value)}
            placeholder="gpt-4o-mini, llama-3.3-70b-versatile, ..."
          />
          <Input
            label={t('ai.settings.apiKey')}
            type={showKey ? 'text' : 'password'}
            value={fbApiKey}
            onChange={(e) => setFbApiKey(e.target.value)}
            placeholder={t('ai.settings.apiKeyPlaceholder')}
          />
          {config?.hasFallbackKey && !fbApiKey && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t('ai.settings.apiKeySet', { key: config.maskedFallbackKey || '****' })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-6 pt-4 border-t border-zinc-200/70 dark:border-zinc-800">
          <Button
            variant="outline"
            onClick={handleTestFb}
            isLoading={testingFb}
            leftIcon={testingFb ? undefined : <Wifi size={16} />}
          >
            {testingFb ? t('ai.settings.testing') : t('ai.settings.testConnection')}
          </Button>
          {config?.hasFallbackKey && (
            <Button
              variant="outline"
              onClick={handleRevokeFb}
              isLoading={revokingFb}
            >
              {fbRevokeArmed ? t('ai.settings.revokeKeyConfirm') : t('ai.settings.revokeFallbackKey')}
            </Button>
          )}
        </div>
        {fbTestResult && (
          <div
            className={cn(
              'mt-3 px-4 py-2.5 rounded-xl text-sm',
              fbTestResult.ok
                ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-300 border border-success-200 dark:border-success-800'
                : 'bg-danger-50 dark:bg-danger-900/20 text-danger-700 dark:text-danger-300 border border-danger-200 dark:border-danger-800'
            )}
          >
            {fbTestResult.ok ? <Wifi size={14} className="inline ms-1 -mt-0.5" /> : <WifiOff size={14} className="inline ms-1 -mt-0.5" />}
            {fbTestResult.message}
          </div>
        )}
      </Card>
    </div>
  );
}
