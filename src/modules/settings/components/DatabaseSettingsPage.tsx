import React, { useState, useEffect, useCallback } from 'react';
import { Database, Server, HardDrive, CheckCircle, XCircle, RefreshCw, Save, Plus, Trash2, Eye, EyeOff, Globe, MonitorSmartphone } from 'lucide-react';
import { Card, Button, Input, Can } from '@/core/ui/components';
import { getDbAdapter, getDbMode, setDbMode, type DbMode, isElectron, getTransportMode, setTransportMode, type PgliteTransportMode } from '@/core/database/adapters';
import {
  listRemoteConnections,
  saveRemoteConnection,
  deleteRemoteConnection,
  getStoredActiveRemoteId,
  setStoredActiveRemoteId,
  testRemoteConnection,
  type VaultConnectionMeta,
} from '@/core/database/connectionVault';
import { validateDatabaseUrl, buildDatabaseUrl, providerLabel, resolveDriver } from '@/core/database/connection';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';

/**
 * Database Settings Page — universal connections.
 *
 *   1. PGlite (local) — zero-config default on every platform.
 *   2. Remote PostgreSQL — ONE pasted DATABASE_URL for any provider
 *      (local, Supabase, Neon, GCP, self-hosted). Desktop talks direct
 *      TCP; web/mobile browsers use the Neon HTTP driver (no TCP in
 *      browsers), so non-Neon remotes are honestly gated with guidance.
 *
 * Secrets: encrypted with the OS keychain on desktop (main process vault),
 * device storage on web (disclosed in the UI).
 */
export const DatabaseSettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);

  const isDesktop = isElectron();
  const [mode, setMode] = useState<DbMode>(() => getDbMode());
  const [connections, setConnections] = useState<VaultConnectionMeta[]>([]);
  const [activeRemoteId, setActiveRemoteId] = useState<string | null>(() => getStoredActiveRemoteId());
  const [isSaving, setIsSaving] = useState(false);
  const [transport, setTransport] = useState<PgliteTransportMode>(() => getTransportMode());

  // Add-connection form
  const [showForm, setShowForm] = useState(false);
  const [connName, setConnName] = useState('');
  const [connUrl, setConnUrl] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [parts, setParts] = useState({ host: '', port: '5432', database: '', user: '', password: '', ssl: true });
  const [formError, setFormError] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isFormSaving, setIsFormSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setConnections(await listRemoteConnections());
      setActiveRemoteId(getStoredActiveRemoteId());
    } catch {
      /* vault unavailable — page still renders local mode */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const detected = validateDatabaseUrl(connUrl);
  const webBlocked = !isDesktop && detected.ok && detected.parsed && resolveDriver(detected.parsed.provider, 'web') === null;

  const syncActiveToDesktop = async (id: string | null) => {
    setStoredActiveRemoteId(id);
    try {
      const b = (window as { electronDB?: { connections?: { setActive?: (p: { id: string | null }) => Promise<{ success: boolean; error?: string }> } } }).electronDB?.connections;
      if (b?.setActive) await b.setActive({ id });
    } catch {
      /* main sync best-effort; reload re-reads the vault */
    }
  };

  const handleTestUrl = async () => {
    setIsTesting(true);
    setTestResult(null);
    setFormError('');
    try {
      const r = await testRemoteConnection(connUrl);
      if (r.success) {
        setTestResult({ ok: true, message: `${t('settings.database.connected')}${r.db ? ` — ${r.db}` : ''}` });
      } else {
        setTestResult({
          ok: false,
          message: r.error === 'webTcpUnsupported' ? t('settings.database.webTcpDesc') : (r.error || t('settings.database.connectionFailed')),
        });
      }
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : t('settings.database.connectionFailed') });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveConnection = async () => {
    setFormError('');
    setIsFormSaving(true);
    try {
      let url = connUrl.trim();
      if (advanced && !url) {
        url = buildDatabaseUrl({ host: parts.host, port: parts.port, database: parts.database, user: parts.user, password: parts.password, ssl: parts.ssl });
      }
      const saved = await saveRemoteConnection({ name: connName, databaseUrl: url });
      if (!saved.success || !saved.connection) {
        const key = saved.error === 'webTcpUnsupported' ? 'settings.database.webTcpDesc' : null;
        throw new Error(key ? t(key) : (saved.error || t('settings.database.saveError')));
      }
      addToast('success', t('settings.database.connSaved'));
      setConnName('');
      setConnUrl('');
      setParts({ host: '', port: '5432', database: '', user: '', password: '', ssl: true });
      setShowForm(false);
      setTestResult(null);
      await refresh();
      // First connection becomes active automatically.
      if (!getStoredActiveRemoteId()) {
        await handleActivate(saved.connection.id, true);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('settings.database.saveError'));
    } finally {
      setIsFormSaving(false);
    }
  };

  const handleActivate = async (id: string, silent = false) => {
    await syncActiveToDesktop(id);
    setDbMode('pg');
    setMode('pg');
    await refresh();
    if (!silent) {
      addToast('success', t('settings.database.connActivated'));
      setTimeout(() => window.location.reload(), 800);
    } else {
      setTimeout(() => window.location.reload(), 800);
    }
  };

  const handleUseLocal = async () => {
    await syncActiveToDesktop(null);
    setDbMode('pglite');
    setMode('pglite');
    setTimeout(() => window.location.reload(), 800);
  };

  const handleDelete = async (id: string) => {
    await deleteRemoteConnection(id);
    addToast('success', t('settings.database.connDeleted'));
    if (getStoredActiveRemoteId() === id) {
      setDbMode('pglite');
      setMode('pglite');
    }
    await refresh();
  };

  const handleTestCurrent = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const adapter = await getDbAdapter();
      const result = await adapter.ping();
      if (result.success) {
        setTestResult({ ok: true, message: result.db || result.message || t('settings.database.connected') });
      } else {
        setTestResult({ ok: false, message: result.message || t('settings.database.connectionFailed') });
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      setTestResult({
        ok: false,
        message: code === 'non-neon-on-web' || code === 'no-remote-connection' || code === 'invalid-remote-url'
          ? t('settings.database.webTcpDesc')
          : (err instanceof Error ? err.message : t('settings.database.connectionFailed')),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveMode = async () => {
    setIsSaving(true);
    try {
      // Remote mode without an active connection is a guaranteed error
      // screen — refuse it loudly, or auto-activate the obvious choice.
      if (mode === 'pg' && !getStoredActiveRemoteId()) {
        if (connections.length === 0) {
          addToast('error', t('settings.database.connEmpty'));
          setIsSaving(false);
          return;
        }
        await handleActivate(connections[0].id, true);
        setIsSaving(false);
        return;
      }
      setDbMode(mode);
      setTransportMode(transport);
      addToast('success', t('settings.database.saved'));
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
              {isDesktop ? <Database size={14} /> : <MonitorSmartphone size={14} />}
              <span>{isDesktop ? t('settings.database.serverRequired') : t('settings.database.remoteWebNote')}</span>
            </div>
          </div>
        </button>
      </div>

      {/* Remote connections (PG mode) */}
      {mode === 'pg' && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400">
              <Globe size={16} />
              <span className="text-sm font-medium">{t('settings.database.remoteTitle')}</span>
            </div>
            {!showForm && (
              <Button variant="ghost" size="sm" leftIcon={<Plus size={14} />} onClick={() => setShowForm(true)}>
                {t('settings.database.addConnection')}
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.database.remoteDesc')}</p>
          {!isDesktop && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t('settings.database.secretOnDevice')}</p>
          )}

          {/* Saved list */}
          {connections.length === 0 && !showForm && (
            <p className="text-sm text-slate-400">{t('settings.database.connEmpty')}</p>
          )}
          <div className="space-y-2">
            {connections.map((c) => {
              const isActive = c.id === activeRemoteId;
              const blocked = !isDesktop && resolveDriver(c.provider, 'web') === null;
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${
                    isActive
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  <Server size={18} className={isActive ? 'text-primary-600' : 'text-slate-400'} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{c.name}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">
                        {providerLabel(c.provider)}
                      </span>
                      {isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300">
                          {t('settings.database.connActive')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 truncate" dir="ltr">{c.user}@{c.host}/{c.database}</p>
                    {blocked && <p className="text-[11px] text-amber-600 mt-0.5">{t('settings.database.webTcpDesc')}</p>}
                  </div>
                  {!isActive && !blocked && (
                    <Button variant="ghost" size="sm" onClick={() => handleActivate(c.id)}>
                      {t('settings.database.connActivate')}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" leftIcon={<Trash2 size={14} />} onClick={() => handleDelete(c.id)} title={t('settings.database.connDelete')} />
                </div>
              );
            })}
          </div>

          {mode === 'pg' && activeRemoteId && (
            <Button variant="secondary" size="sm" onClick={handleUseLocal}>
              {t('settings.database.useLocal')}
            </Button>
          )}

          {/* Add form */}
          {showForm && (
            <div className="space-y-3 p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800">
              <Input label={t('settings.database.connName')} value={connName} onChange={(e) => setConnName(e.target.value)} placeholder={t('settings.database.connNamePh')} />
              {!advanced ? (
                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('settings.database.connUrl')}</label>
                  <div className="flex gap-2 mt-1">
                    <input
                      type={showUrl ? 'text' : 'password'}
                      value={connUrl}
                      onChange={(e) => { setConnUrl(e.target.value); setTestResult(null); }}
                      placeholder={t('settings.database.connUrlPh')}
                      dir="ltr"
                      autoComplete="off"
                      className="flex-1 px-3 py-2 text-sm font-mono bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <Button variant="ghost" size="sm" leftIcon={showUrl ? <EyeOff size={14} /> : <Eye size={14} />} onClick={() => setShowUrl((v) => !v)} title={showUrl ? t('settings.database.connHide') : t('settings.database.connShow')} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{t('settings.database.connUrlHint')}</p>
                  {detected.ok && detected.parsed && (
                    <p className="text-xs text-emerald-600 mt-1">
                      {providerLabel(detected.parsed.provider)} · <span dir="ltr">{detected.parsed.host}/{detected.parsed.database}</span>
                    </p>
                  )}
                  {webBlocked && <p className="text-xs text-amber-600 mt-1">{t('settings.database.webTcpDesc')}</p>}
                  <button onClick={() => setAdvanced(true)} className="text-xs text-primary-600 hover:underline mt-1">
                    {t('settings.database.connAdvanced')}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Input label={t('onboarding.host')} value={parts.host} onChange={(e) => setParts({ ...parts, host: e.target.value })} />
                    <Input label={t('onboarding.port')} value={parts.port} onChange={(e) => setParts({ ...parts, port: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Input label={t('onboarding.dbName')} value={parts.database} onChange={(e) => setParts({ ...parts, database: e.target.value })} />
                    <Input label={t('auth.username')} value={parts.user} onChange={(e) => setParts({ ...parts, user: e.target.value })} />
                  </div>
                  <Input label={t('auth.password')} type="password" value={parts.password} onChange={(e) => setParts({ ...parts, password: e.target.value })} />
                  <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer">
                    <input type="checkbox" checked={parts.ssl} onChange={(e) => setParts({ ...parts, ssl: e.target.checked })} className="rounded border-slate-300 text-primary-600" />
                    {t('settings.database.connSsl')}
                  </label>
                  <button onClick={() => setAdvanced(false)} className="text-xs text-primary-600 hover:underline">
                    {t('settings.database.connUrl')}
                  </button>
                </div>
              )}
              {formError && (
                <div className="flex items-center gap-2 text-rose-600 bg-rose-50 dark:bg-rose-900/20 p-3 rounded-lg">
                  <XCircle size={18} />
                  <span className="text-sm">{formError}</span>
                </div>
              )}
              {testResult && (
                <div className={`flex items-center gap-2 p-3 rounded-lg ${testResult.ok ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20' : 'text-rose-600 bg-rose-50 dark:bg-rose-900/20'}`}>
                  {testResult.ok ? <CheckCircle size={18} /> : <XCircle size={18} />}
                  <span className="text-sm font-medium">{testResult.message}</span>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setFormError(''); setTestResult(null); }}>
                  {t('cancel')}
                </Button>
                <Button variant="ghost" size="sm" onClick={handleTestUrl} isLoading={isTesting} leftIcon={<RefreshCw size={14} />}>
                  {t('settings.database.connTest')}
                </Button>
                <Can action="edit" module="settings">
                  <Button variant="primary" size="sm" onClick={handleSaveConnection} isLoading={isFormSaving} leftIcon={<Save size={14} />}>
                    {t('settings.database.connSave')}
                  </Button>
                </Can>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* PGlite engine placement (only for local mode) */}
      {mode === 'pglite' && (
        <Card className="p-5">
          <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400 mb-1">
            <HardDrive size={16} />
            <span className="text-sm font-medium">{t('settings.database.engineTitle')}</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{t('settings.database.engineDesc')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(['main', 'worker'] as PgliteTransportMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setTransport(v)}
                className={`p-4 rounded-xl border-2 text-right transition-all ${
                  transport === v
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300'
                }`}
              >
                <p className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  {v === 'main' ? t('settings.database.engineMain') : t('settings.database.engineWorker')}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {v === 'main' ? t('settings.database.engineMainDesc') : t('settings.database.engineWorkerDesc')}
                </p>
              </button>
            ))}
          </div>
          {transport === 'worker' && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">{t('settings.database.engineSlowBoot')}</p>
          )}
        </Card>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-4 border-t border-slate-200 dark:border-slate-800">
        <Button variant="ghost" onClick={handleTestCurrent} isLoading={isTesting} leftIcon={<RefreshCw size={16} />}>
          {t('onboarding.testConnection')}
        </Button>
        <Can action="edit" module="settings">
          <Button variant="primary" onClick={handleSaveMode} isLoading={isSaving} leftIcon={<Save size={16} />}>
            {t('settings.database.save')}
          </Button>
        </Can>
      </div>
    </div>
  );
};

export default DatabaseSettingsPage;
