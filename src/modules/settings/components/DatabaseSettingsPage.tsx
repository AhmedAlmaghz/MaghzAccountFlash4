import React, { useState, useEffect } from 'react';
import { Database, Server, HardDrive, CheckCircle, XCircle, RefreshCw, Save } from 'lucide-react';
import { Card, Button, Input, Can } from '@/core/ui/components';
import { getDbAdapter, getDbMode, setDbMode, type DbMode } from '@/core/database/adapters';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';

/**
 * Database Settings Page
 * Lets the user choose between:
 *   1. PGlite (PostgreSQL WASM) — local, no-install, persists in IndexedDB
 *   2. PostgreSQL server — via Electron IPC (desktop) or HTTP bridge (web)
 *
 * The choice is stored in localStorage and read by getDbAdapter().
 */
export const DatabaseSettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);

  const [mode, setMode] = useState<DbMode>(() => getDbMode());
  const [pgConfig, setPgConfig] = useState({
    host: 'localhost',
    port: '5432',
    database: 'MaghzAccountFlash35',
    user: 'maghz',
    password: '',
  });
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load current PG config from onboarding store if available
  useEffect(() => {
    try {
      const raw = localStorage.getItem('maghzaccount-onboarding');
      if (raw) {
        const parsed = JSON.parse(raw);
        const db = parsed?.state?.dbConfig;
        if (db) {
          setPgConfig({
            host: db.host || 'localhost',
            port: db.port || '5432',
            database: db.database || 'MaghzAccountFlash35',
            user: db.user || 'maghz',
            password: '',
          });
        }
      }
    } catch { /* ignore */ }
  }, []);

  const handleTest = async () => {
    setIsTesting(true);
    setTestStatus('idle');
    setTestMessage('');
    try {
      // Temporarily switch mode to test the selected backend
      const previousMode = getDbMode();
      setDbMode(mode);
      const adapter = await getDbAdapter();
      const result = await adapter.ping();
      if (result.success) {
        setTestStatus('success');
        setTestMessage(result.db || result.message || t('settings.database.connected'));
      } else {
        setTestStatus('error');
        setTestMessage(result.message || t('settings.database.connectionFailed'));
      }
      // Restore previous mode (the actual save happens on "Save")
      setDbMode(previousMode);
    } catch (err) {
      setTestStatus('error');
      setTestMessage(err instanceof Error ? err.message : t('settings.database.connectionFailed'));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      setDbMode(mode);

      // If PG mode, persist the connection config for Electron main process
      if (mode === 'pg' && typeof window !== 'undefined' && (window as { electronDB?: { updateConfig?: (c: object) => Promise<{ success: boolean; error?: string }> } }).electronDB?.updateConfig) {
        const result = await (window as { electronDB?: { updateConfig?: (c: object) => Promise<{ success: boolean; error?: string }> } }).electronDB!.updateConfig!({
          host: pgConfig.host,
          port: pgConfig.port,
          database: pgConfig.database,
          user: pgConfig.user,
          password: pgConfig.password,
        });
        if (!result.success) {
          addToast('error', result.error || t('settings.database.saveError'));
          setIsSaving(false);
          return;
        }
      }

      addToast('success', t('settings.database.saved'));
      // Reload to re-initialize the adapter with the new mode
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('settings.database.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">{t('settings.database.title')}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.database.description')}</p>
        </div>
      </div>

      {/* Mode selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* PGlite option */}
        <button
          onClick={() => setMode('pglite')}
          className={`p-5 rounded-xl border-2 text-right transition-all flex items-start gap-4 ${
            mode === 'pglite'
              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300'
          }`}
        >
          <div className={`mt-0.5 ${mode === 'pglite' ? 'text-primary-600' : 'text-slate-400'}`}>
            <HardDrive size={24} />
          </div>
          <div className="flex-1">
            <p className="font-bold text-slate-900 dark:text-slate-100">{t('settings.database.pglite')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('settings.database.pgliteDesc')}</p>
            <div className="mt-2 flex items-center gap-2 text-xs text-emerald-600">
              <CheckCircle size={14} />
              <span>{t('settings.database.noInstall')}</span>
            </div>
          </div>
        </button>

        {/* PostgreSQL option */}
        <button
          onClick={() => setMode('pg')}
          className={`p-5 rounded-xl border-2 text-right transition-all flex items-start gap-4 ${
            mode === 'pg'
              ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300'
          }`}
        >
          <div className={`mt-0.5 ${mode === 'pg' ? 'text-primary-600' : 'text-slate-400'}`}>
            <Server size={24} />
          </div>
          <div className="flex-1">
            <p className="font-bold text-slate-900 dark:text-slate-100">{t('settings.database.postgres')}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t('settings.database.postgresDesc')}</p>
            <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
              <Database size={14} />
              <span>{t('settings.database.serverRequired')}</span>
            </div>
          </div>
        </button>
      </div>

      {/* PG connection form (only when PG selected) */}
      {mode === 'pg' && (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400 mb-4">
            <Server size={16} />
            <span className="text-sm font-medium">PostgreSQL</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t('onboarding.host')} value={pgConfig.host} onChange={e => setPgConfig({ ...pgConfig, host: e.target.value })} />
            <Input label={t('onboarding.port')} value={pgConfig.port} onChange={e => setPgConfig({ ...pgConfig, port: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <Input label={t('onboarding.dbName')} value={pgConfig.database} onChange={e => setPgConfig({ ...pgConfig, database: e.target.value })} />
            <Input label={t('auth.username')} value={pgConfig.user} onChange={e => setPgConfig({ ...pgConfig, user: e.target.value })} />
          </div>
          <div className="mt-4">
            <Input label={t('auth.password')} type="password" value={pgConfig.password} onChange={e => setPgConfig({ ...pgConfig, password: e.target.value })} />
          </div>
        </Card>
      )}

      {/* Test result */}
      {testStatus === 'success' && (
        <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-lg">
          <CheckCircle size={18} />
          <span className="text-sm font-medium">{testMessage}</span>
        </div>
      )}
      {testStatus === 'error' && (
        <div className="flex items-center gap-2 text-rose-600 bg-rose-50 dark:bg-rose-900/20 p-3 rounded-lg">
          <XCircle size={18} />
          <span className="text-sm font-medium">{testMessage}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4 border-t border-slate-200 dark:border-slate-800">
        <Button variant="ghost" onClick={handleTest} isLoading={isTesting} leftIcon={<RefreshCw size={16} />}>
          {t('onboarding.testConnection')}
        </Button>
        <Can action="edit" module="settings">
          <Button variant="primary" onClick={handleSave} isLoading={isSaving} leftIcon={<Save size={16} />}>
            {t('settings.database.save')}
          </Button>
        </Can>
      </div>
    </div>
  );
};

export default DatabaseSettingsPage;