import React, { useState, useRef, useEffect } from 'react';
import { Database, Download, Upload, RotateCcw, Check, AlertCircle, FileArchive } from 'lucide-react';
import { Card, Button, Can } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { getDbAdapter } from '@/core/database/adapters';
import { logAudit } from '@/core/utils/auditLogger';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';

type BackupStatus = 'idle' | 'backing-up' | 'restoring' | 'success' | 'error';

interface BackupRecord {
  date: string;
  size: string;
  type: 'auto' | 'manual';
}

export const BackupPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const user = useAuthStore((state) => state.user);
  const [status, setStatus] = useState<BackupStatus>('idle');
  const [message, setMessage] = useState('');
  const [restoringFile, setRestoringFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recentBackups] = useState<BackupRecord[]>([
    { date: new Date().toISOString().split('T')[0], size: '12.5 MB', type: 'manual' },
  ]);

  useEffect(() => {
    if (status === 'success' || status === 'error') {
      const timer = setTimeout(() => setStatus('idle'), 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [status]);

  const handleBackup = async () => {
    if (!activeCompany?.id) {
      addToast('error', t('settings.backup.noCompany'));
      return;
    }
    setStatus('backing-up');
    setMessage(t('settings.backup.creatingBackup'));
    try {
      const adapter = await getDbAdapter();
      const tables = await adapter.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
      );
      const records: Record<string, unknown> = {};
      for (const row of tables.success && tables.rows ? tables.rows : []) {
        const data = await adapter.query(
          `SELECT * FROM ${row.tablename} WHERE company_id = $1 LIMIT 1000`,
          [activeCompany.id]
        );
        if (data.success && data.rows) {
          records[row.tablename] = data.rows;
        }
      }
      const backup = {
        companyId: activeCompany.id,
        timestamp: new Date().toISOString(),
        version: '1.0',
        records,
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${activeCompany.id}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      await logAudit({
        userId: user?.id || 'system',
        username: user?.username,
        action: 'create',
        tableName: 'backups',
        recordId: activeCompany.id,
        recordLabel: `Backup ${Object.keys(records).length} tables`,
        companyId: activeCompany.id,
      });

      setStatus('success');
      setMessage(t('settings.backup.successMessage', { tables: Object.keys(records).length }));
      addToast('success', t('settings.backup.successToast'));
    } catch (err) {
      setStatus('error');
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessage(t('settings.backup.errorMessage', { error: errMsg }));
      addToast('error', t('settings.backup.errorToast'));
    }
  };

  const handleRestore = async () => {
    if (!restoringFile) {
      addToast('error', t('settings.backup.noFileSelected'));
      return;
    }
    if (!activeCompany?.id) {
      addToast('error', t('settings.backup.noCompany'));
      return;
    }
    setStatus('restoring');
    setMessage(t('settings.backup.restoring'));
    try {
      const text = await restoringFile.text();
      const backup = JSON.parse(text);
      if (!backup.records || !backup.companyId) {
        throw new Error(t('settings.backup.invalidFile'));
      }
      await logAudit({
        userId: user?.id || 'system',
        username: user?.username,
        action: 'update',
        tableName: 'backups',
        recordId: activeCompany.id,
        recordLabel: `Restore from ${restoringFile.name}`,
        companyId: activeCompany.id,
      });

      setStatus('success');
      setMessage(t('settings.backup.restoreNote'));
      addToast('success', t('settings.backup.restoreRecorded'));
      setRestoringFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setStatus('error');
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessage(t('settings.backup.errorMessage', { error: errMsg }));
      addToast('error', t('settings.backup.errorToast'));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRestoringFile(file);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Database size={28} className="text-primary-600 dark:text-primary-400" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('settings.backup.title')}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">{t('settings.backup.subtitle')}</p>
        </div>
      </div>

      {status === 'success' && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 flex items-center gap-3">
          <Check size={20} className="text-emerald-600 shrink-0" />
          <p className="text-emerald-700 dark:text-emerald-300 text-sm">{message}</p>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle size={20} className="text-rose-600 shrink-0" />
          <p className="text-rose-700 dark:text-rose-300 text-sm">{message}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <div className="p-6 text-center">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Download size={32} className="text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50 mb-2">{t('settings.backup.createTitle')}</h3>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">{t('settings.backup.createDesc')}</p>
            <Can action="create" module="settings">
              <Button
                variant="primary"
                className="w-full"
                leftIcon={<Download size={18} />}
                onClick={handleBackup}
                isLoading={status === 'backing-up'}
                disabled={!activeCompany}
              >
                {t('settings.backup.create')}
              </Button>
            </Can>
          </div>
        </Card>

        <Card>
          <div className="p-6 text-center">
            <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <RotateCcw size={32} className="text-amber-600 dark:text-amber-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50 mb-2">{t('settings.backup.restoreTitle')}</h3>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">{t('settings.backup.restoreDesc')}</p>
            <div className="flex flex-col gap-3">
              <label className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-lg cursor-pointer hover:border-primary-500 dark:hover:border-primary-400 transition-colors">
                <Upload size={18} className="text-slate-500" />
                <span className="text-sm text-slate-500 truncate">
                  {restoringFile ? restoringFile.name : t('settings.backup.chooseFile')}
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".json,.zip"
                  onChange={handleFileChange}
                />
              </label>
              <Can action="edit" module="settings">
                <Button
                  variant="secondary"
                  className="w-full"
                  leftIcon={<RotateCcw size={18} />}
                  onClick={handleRestore}
                  isLoading={status === 'restoring'}
                  disabled={!restoringFile || !activeCompany}
                >
                  {t('settings.backup.restore')}
                </Button>
              </Can>
            </div>
          </div>
        </Card>
      </div>

      {recentBackups.length > 0 && (
        <Card>
          <div className="p-4">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">{t('settings.backup.recentTitle')}</h3>
            <div className="space-y-2">
              {recentBackups.map((backup, i) => (
                <div key={i} className="flex items-center justify-between py-2 px-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileArchive size={16} className="text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{backup.date}</p>
                      <p className="text-xs text-slate-400">
                        {backup.type === 'auto' ? t('settings.backup.typeAuto') : t('settings.backup.typeManual')}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm text-slate-500">{backup.size}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

export default BackupPage;
