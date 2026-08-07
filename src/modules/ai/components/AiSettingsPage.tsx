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
      <div className="h-full flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        {t('ai.noPermission')}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ArrowRight size={20} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">{t('ai.settings.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('ai.settings.subtitle')}</p>
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
                'px-3 py-2 text-xs font-medium rounded-lg border transition-colors',
                provider === p.id
                  ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
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
                  className="pointer-events-auto cursor-pointer text-slate-400 hover:text-slate-600"
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
            />
            {/* Current key status */}
            {config?.hasApiKey && !apiKey && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {config.keySource === 'env'
                  ? t('ai.settings.apiKeyEnv')
                  : t('ai.settings.apiKeySet', { key: config.maskedKey || '****' })}
              </p>
            )}
          </div>

          {/* Enabled toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              className={cn(
                'relative w-10 h-6 rounded-full transition-colors',
                enabled ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-600'
              )}
              onClick={() => setEnabled(!enabled)}
            >
              <div
                className={cn(
                  'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                  enabled ? 'right-1' : 'left-1'
                )}
              />
            </div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.settings.enabled')}</span>
          </label>

          {/* Security note */}
          <p className="text-xs text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3">
            🔒 {t('ai.settings.securityNote')}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 mt-6 pt-4 border-t border-slate-200 dark:border-slate-800">
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
              'mt-3 px-4 py-2.5 rounded-lg text-sm',
              testResult.ok
                ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-300 border border-success-200 dark:border-success-800'
                : 'bg-danger-50 dark:bg-danger-900/20 text-danger-700 dark:text-danger-300 border border-danger-200 dark:border-danger-800'
            )}
          >
            {testResult.ok ? <Wifi size={14} className="inline ml-1" /> : <WifiOff size={14} className="inline ml-1" />}
            {testResult.message}
          </div>
        )}
      </Card>
    </div>
  );
}
