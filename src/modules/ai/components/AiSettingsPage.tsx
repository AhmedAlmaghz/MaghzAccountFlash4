import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Save, Wifi, WifiOff, Loader2, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAppStore } from '@/core/store';
import { usePermission } from '@/modules/auth/hooks/usePermission';
import { aiApi } from '../api';
import type { AiPublicConfig } from '../types';
import { Button } from '@/core/ui/components/Button';
import { Card, CardTitle, CardDescription } from '@/core/ui/components/Card';
import { Input } from '@/core/ui/components/Input';
import { useToastStore } from '@/core/store/toastStore';
import { cn } from '@/core/utils';

const PROVIDERS = [
  { id: 'gemini', label: 'ai.settings.presets.gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  { id: 'openai', label: 'ai.settings.presets.openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'openrouter', label: 'ai.settings.presets.openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'groq', label: 'ai.settings.presets.groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'ollama', label: 'ai.settings.presets.ollama', baseUrl: 'http://localhost:11434/v1' },
  { id: 'custom', label: 'ai.settings.presets.custom', baseUrl: '' },
];

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

  // Form state
  const [provider, setProvider] = useState('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(true);

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
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [company?.id]);

  const handleProviderChange = useCallback((id: string) => {
    setProvider(id);
    const preset = PROVIDERS.find((p) => p.id === id);
    if (preset && preset.baseUrl) {
      setBaseUrl(preset.baseUrl);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!company?.id) return;
    setSaving(true);
    try {
      const res = await aiApi.saveConfig({
        companyId: company.id,
        provider,
        baseUrl,
        model,
        apiKey: apiKey || undefined,
        enabled,
      });
      if (res.success) {
        addToast('success', t('ai.settings.saved'));
        // Refresh config to get updated masked key
        const fresh = await aiApi.getConfig(company.id);
        if (fresh.success && fresh.data) setConfig(fresh.data);
      } else {
        addToast('error', res.error || t('ai.errors.generic'));
      }
    } finally {
      setSaving(false);
    }
  }, [company?.id, provider, baseUrl, model, apiKey, enabled, addToast, t]);

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
                  aria-label={showKey ? t('ai.settings.apiKey') : t('ai.settings.apiKey')}
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

          {/* Security note */}
          <p className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-xl p-3 leading-relaxed">
            🔒 {t('ai.settings.securityNote')}
          </p>
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
    </div>
  );
}
