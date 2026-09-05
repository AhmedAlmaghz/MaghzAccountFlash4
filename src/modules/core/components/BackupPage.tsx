import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  Clock,
  Database,
  Download,
  FileArchive,
  FolderDown,
  HardDrive,
  Cloud,
  CloudOff,
  KeyRound,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Button, Can, Card, ConfirmDialog, Input, Modal, PageHeader } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { logAudit } from '@/core/utils/auditLogger';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { BackupError, decodeBackup, encodeBackup } from '@/core/backup/backupEngine';
import { BACKUP_FILE_EXTENSION, buildBackupFileName } from '@/core/backup/backupTables';
import {
  applyRestore,
  downloadEnvelopeText,
  filePickersSupported,
  getBackupSetting,
  pickBackupText,
  readBackupRows,
  setBackupSetting,
} from '@/core/backup/backupService';
import {
  loadHistory,
  newHistoryId,
  recordHistory,
  removeHistory,
  type BackupHistoryEntry,
} from '@/core/backup/backupHistory';
import {
  deleteFromOpfs,
  listOpfs,
  opfsSupported,
  readFromOpfs,
  type OpfsFileInfo,
} from '@/core/backup/opfsStore';
import { DriveClient, type DriveFile } from '@/core/backup/googleDrive';

type Busy = 'idle' | 'backing-up' | 'restoring' | 'drive' | 'opfs';
type Destination = 'local' | 'drive';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export const BackupPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const user = useAuthStore((state) => state.user);
  const companyId = activeCompany?.id ?? '';
  const companyName = activeCompany?.name ?? 'company';

  const [busy, setBusy] = useState<Busy>('idle');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [history, setHistory] = useState<BackupHistoryEntry[]>([]);
  const [opfsFiles, setOpfsFiles] = useState<OpfsFileInfo[]>([]);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [driveConnected, setDriveConnected] = useState(false);
  const [clientId, setClientId] = useState('');
  const [destination, setDestination] = useState<Destination>('local');
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [lastAutoAt, setLastAutoAt] = useState<string | null>(null);
  const [restoreText, setRestoreText] = useState<{ name: string; text: string } | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreSummary, setRestoreSummary] = useState<{
    companyName: string;
    createdAt: string;
    tables: number;
    rows: number;
    encrypted: boolean;
  } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BackupHistoryEntry | null>(null);
  const [opfsPickerOpen, setOpfsPickerOpen] = useState(false);
  // One client per client-id (memoized): the OAuth token lives on the
  // instance in memory only and survives unrelated re-renders.
  const driveClient = useMemo(
    () => (clientId.trim() ? new DriveClient(clientId.trim()) : null),
    [clientId],
  );

  const refreshHistory = useCallback(() => {
    if (companyId) setHistory(loadHistory(companyId));
  }, [companyId]);

  const refreshOpfs = useCallback(async () => {
    try {
      setOpfsFiles(await listOpfs());
    } catch {
      setOpfsFiles([]);
    }
  }, []);

  const refreshDrive = useCallback(async () => {
    if (driveClient?.connected) {
      try {
        setDriveFiles(await driveClient.listBackups());
      } catch {
        // listing failure must not nuke the last known list
      }
    }
  }, [driveClient]);

  useEffect(() => {
    refreshHistory();
    void refreshOpfs();
    if (!companyId) return;
    void getBackupSetting(companyId, 'backup.googleClientId').then((v) => {
      if (v) setClientId(v);
    });
    void getBackupSetting(companyId, 'backup.autoEnabled').then((v) => setAutoEnabled(v === 'true'));
    void getBackupSetting(companyId, 'backup.lastAutoAt').then((v) =>
      setLastAutoAt(v ? new Date(Number(v)).toISOString() : null),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const flash = (kind: 'success' | 'error', text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice(null), 6000);
  };

  const audit = async (action: 'create' | 'update', recordId: string, recordLabel: string) => {
    try {
      await logAudit({
        userId: user?.id || 'system',
        username: user?.username,
        action,
        tableName: 'backups',
        recordId,
        recordLabel,
        companyId,
      });
    } catch {
      // audit is best-effort
    }
  };

  // ------------------------------------------------------------- create
  const handleBackup = async () => {
    if (!companyId) {
      addToast('error', t('settings.backup.noCompany'));
      return;
    }
    if (encrypt && !password) {
      addToast('error', t('settings.backup.passwordRequired'));
      return;
    }
    if (encrypt && password !== confirmPassword) {
      addToast('error', t('settings.backup.passwordMismatch'));
      return;
    }
    if (destination === 'drive' && !driveClient?.connected) {
      addToast('error', t('settings.backup.driveNotConnected'));
      return;
    }
    setBusy('backing-up');
    try {
      const { tables, warnings } = await readBackupRows(companyId);
      const envelope = await encodeBackup(tables, {
        companyId,
        companyName,
        password: encrypt ? password : undefined,
      });
      const { manifest } = await decodeBackup(envelope, encrypt ? password : undefined);
      const name = buildBackupFileName(companyName);
      const size = new Blob([envelope]).size;
      const destinations: BackupHistoryEntry['destinations'] = {};

      if (destination === 'drive' && driveClient) {
        setBusy('drive');
        const { id } = await driveClient.uploadBackup(name, envelope);
        destinations.driveFileId = id;
        await refreshDrive();
      } else {
        const { savedToDevice } = await downloadEnvelopeText(name, envelope);
        destinations.local = savedToDevice;
      }

      const entry: BackupHistoryEntry = {
        id: newHistoryId(),
        name,
        size,
        createdAt: new Date().toISOString(),
        kind: 'manual',
        encrypted: encrypt,
        tables: Object.keys(manifest.tables).length,
        rows: manifest.totalRows,
        destinations,
      };
      setHistory(recordHistory(companyId, entry));
      await audit('create', companyId, `Backup ${entry.tables} tables, ${entry.rows} rows → ${destination}`);
      if (warnings.length > 0) {
        flash('success', t('settings.backup.successWithWarnings', { warnings: warnings.length }));
      } else {
        flash('success', t('settings.backup.successMessage', { tables: entry.tables }));
      }
      addToast('success', t('settings.backup.successToast'));
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      flash('error', t('settings.backup.errorMessage', { error: msg }));
      addToast('error', t('settings.backup.errorToast'));
    } finally {
      setBusy('idle');
    }
  };

  // ------------------------------------------------------------- restore
  const inspectRestoreText = async (name: string, text: string, pwd?: string) => {
    try {
      // Decode WITHOUT password first to learn whether one is needed.
      let decoded;
      try {
        decoded = await decodeBackup(text);
      } catch (e) {
        if (e instanceof BackupError && e.code === 'PASSWORD_REQUIRED' && pwd) {
          decoded = await decodeBackup(text, pwd);
        } else {
          throw e;
        }
      }
      if (decoded.manifest.companyId !== companyId) {
        throw new Error(t('settings.backup.companyMismatch'));
      }
      setRestoreText({ name, text });
      setRestoreSummary({
        companyName: decoded.manifest.companyName,
        createdAt: decoded.manifest.createdAt,
        tables: Object.keys(decoded.manifest.tables).length,
        rows: decoded.manifest.totalRows,
        encrypted: decoded.manifest.encrypted,
      });
    } catch (err) {
      setRestoreText(null);
      setRestoreSummary(null);
      addToast('error', err instanceof Error ? err.message : t('settings.backup.invalidFile'));
    }
  };

  const handlePickFile = async () => {
    try {
      const picked = await pickBackupText();
      if (picked) void inspectRestoreText(picked.name, picked.text);
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('settings.backup.errorToast'));
    }
  };

  const handleRestoreOpfs = async (file: OpfsFileInfo) => {
    try {
      const text = await readFromOpfs(file.name);
      await inspectRestoreText(file.name, text);
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('settings.backup.errorToast'));
    }
  };

  const handleRestoreDrive = async (file: DriveFile) => {
    if (!driveClient) return;
    setBusy('drive');
    try {
      const text = await driveClient.downloadBackup(file.id);
      await inspectRestoreText(file.name, text);
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('settings.backup.errorToast'));
    } finally {
      setBusy('idle');
    }
  };

  const handleConfirmRestore = async () => {
    if (!restoreText || !companyId) return;
    setConfirmRestore(false);
    setBusy('restoring');
    try {
      const { tables } = await decodeBackup(
        restoreText.text,
        restoreSummary?.encrypted ? restorePassword || undefined : undefined,
      );
      const { restored, warnings } = await applyRestore(companyId, tables);
      await audit('update', companyId, `Restore ${restored} rows from ${restoreText.name}`);
      flash('success', t('settings.backup.restoreSuccess', { rows: restored }));
      addToast('success', t('settings.backup.restoreSuccess', { rows: restored }));
      if (warnings.length > 0) {
        flash('success', t('settings.backup.successWithWarnings', { warnings: warnings.length }));
      }
      setRestoreText(null);
      setRestoreSummary(null);
      setRestorePassword('');
      // Reload so every screen re-reads the restored data.
      window.setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      flash('error', t('settings.backup.errorMessage', { error: msg }));
      addToast('error', t('settings.backup.errorToast'));
    } finally {
      setBusy('idle');
    }
  };

  // ---------------------------------------------------------------- drive
  const handleSaveClientId = async () => {
    if (!companyId) return;
    try {
      await setBackupSetting(companyId, 'backup.googleClientId', clientId.trim());
      setDriveConnected(false);
      setDriveFiles([]);
      addToast('success', t('settings.backup.clientIdSaved'));
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('settings.backup.errorToast'));
    }
  };

  const handleDriveConnect = async () => {
    if (!driveClient) {
      addToast('error', t('settings.backup.clientIdRequired'));
      return;
    }
    setBusy('drive');
    try {
      await driveClient.connect();
      setDriveConnected(true);
      setDriveFiles(await driveClient.listBackups());
      addToast('success', t('settings.backup.connected'));
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('settings.backup.errorToast'));
    } finally {
      setBusy('idle');
    }
  };

  const handleDriveDisconnect = () => {
    driveClient?.disconnect();
    setDriveConnected(false);
    setDriveFiles([]);
  };

  const handleDriveDelete = async (file: DriveFile) => {
    if (!driveClient) return;
    try {
      await driveClient.deleteBackup(file.id);
      setDriveFiles((list) => list.filter((f) => f.id !== file.id));
      addToast('success', t('settings.backup.driveDeleted'));
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('settings.backup.errorToast'));
    }
  };

  // ----------------------------------------------------------------- auto
  const handleAutoToggle = async () => {
    if (!companyId) return;
    const next = !autoEnabled;
    try {
      await setBackupSetting(companyId, 'backup.autoEnabled', String(next));
      setAutoEnabled(next);
      addToast('success', t(next ? 'settings.backup.autoEnabledToast' : 'settings.backup.autoDisabledToast'));
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : t('settings.backup.errorToast'));
    }
  };

  const handleDeleteHistory = async (entry: BackupHistoryEntry) => {
    setDeleteTarget(null);
    try {
      if (entry.destinations.opfs) {
        try {
          await deleteFromOpfs(entry.name);
        } catch {
          // copy may already be gone
        }
        await refreshOpfs();
      }
      if (entry.destinations.driveFileId && driveClient?.connected) {
        try {
          await driveClient.deleteBackup(entry.destinations.driveFileId);
          await refreshDrive();
        } catch {
          // keep metadata deletion going
        }
      }
    } finally {
      setHistory(removeHistory(companyId, entry.id));
    }
  };

  const lastBackup = history[0] ?? null;
  const destinationBadge = (entry: BackupHistoryEntry) => {
    const parts: string[] = [];
    if (entry.destinations.local) parts.push(t('settings.backup.localBadge'));
    if (entry.destinations.opfs) parts.push(t('settings.backup.opfsBadge'));
    if (entry.destinations.driveFileId) parts.push(t('settings.backup.driveBadge'));
    return parts.join(' · ') || '—';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title={t('settings.backup.title')}
        subtitle={t('settings.backup.subtitle')}
        icon={<Database size={22} />}
      />

      {notice && (
        <div
          className={
            notice.kind === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 flex items-center gap-3'
              : 'bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg p-4 flex items-center gap-3'
          }
        >
          {notice.kind === 'success' ? (
            <Check size={20} className="text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle size={20} className="text-rose-600 shrink-0" />
          )}
          <p
            className={
              notice.kind === 'success'
                ? 'text-emerald-700 dark:text-emerald-300 text-sm'
                : 'text-rose-700 dark:text-rose-300 text-sm'
            }
          >
            {notice.text}
          </p>
        </div>
      )}

      {/* Status */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <div className="p-4 flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center shrink-0">
              <Clock size={18} className="text-primary-600 dark:text-primary-400" />
            </span>
            <div className="min-w-0">
              <p className="form-label">{t('settings.backup.lastBackup')}</p>
              <p className="text-sm font-semibold truncate">
                {lastBackup ? formatDateTime(lastBackup.createdAt) : t('settings.backup.neverBackedUp')}
              </p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-4 flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-gold-100 dark:bg-gold-900/30 flex items-center justify-center shrink-0">
              <FileArchive size={18} className="text-gold-600 dark:text-gold-400" />
            </span>
            <div className="min-w-0">
              <p className="form-label">{t('settings.backup.totalBackups')}</p>
              <p className="text-sm font-semibold tabular">{history.length}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-4 flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
              <ShieldCheck size={18} className="text-emerald-600 dark:text-emerald-400" />
            </span>
            <div className="min-w-0">
              <p className="form-label">{t('settings.backup.autoBackup')}</p>
              <p className="text-sm font-semibold">
                {autoEnabled ? t('settings.backup.typeAuto') : t('settings.backup.typeManual')}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Create */}
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-1">{t('settings.backup.createTitle')}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t('settings.backup.createDesc')}</p>

          <p className="form-label mb-2">{t('settings.backup.destination')}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            <button
              type="button"
              onClick={() => setDestination('local')}
              aria-pressed={destination === 'local'}
              className={`flex items-center gap-3 rounded-xl border-2 p-3 text-start transition-all ${
                destination === 'local'
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
              }`}
            >
              <HardDrive size={20} className="text-primary-600 dark:text-primary-400 shrink-0" />
              <span>
                <span className="block text-sm font-semibold">{t('settings.backup.destLocal')}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {filePickersSupported()
                    ? t('settings.backup.destLocalDesc')
                    : t('settings.backup.destLocalFallback')}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setDestination('drive')}
              aria-pressed={destination === 'drive'}
              className={`flex items-center gap-3 rounded-xl border-2 p-3 text-start transition-all ${
                destination === 'drive'
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
              }`}
            >
              <Cloud size={20} className="text-sky-600 dark:text-sky-400 shrink-0" />
              <span>
                <span className="block text-sm font-semibold">{t('settings.backup.destDrive')}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{t('settings.backup.destDriveDesc')}</span>
              </span>
            </button>
          </div>

          <label className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-700 p-3 mb-4 cursor-pointer">
            <span className="flex items-center gap-2 text-sm font-medium">
              <KeyRound size={16} className="text-gold-600 dark:text-gold-400" />
              {t('settings.backup.encrypt')}
            </span>
            <input
              type="checkbox"
              checked={encrypt}
              onChange={(e) => setEncrypt(e.target.checked)}
              className="w-5 h-5 accent-primary-600"
              aria-label={t('settings.backup.encrypt')}
            />
          </label>
          {encrypt && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <Input
                label={t('settings.backup.password')}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <Input
                label={t('settings.backup.confirmPassword')}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          )}

          <Can action="create" module="settings">
            <Button
              variant="primary"
              className="w-full sm:w-auto"
              leftIcon={<Download size={18} />}
              onClick={handleBackup}
              isLoading={busy === 'backing-up' || busy === 'drive'}
              disabled={!activeCompany || busy !== 'idle'}
            >
              {busy === 'backing-up' ? t('settings.backup.creatingBackup') : t('settings.backup.create')}
            </Button>
          </Can>
        </div>
      </Card>

      {/* Restore */}
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-1">{t('settings.backup.restoreTitle')}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{t('settings.backup.restoreDesc')}</p>
          <div className="flex flex-wrap gap-2 mb-4">
            <Button variant="secondary" leftIcon={<FolderDown size={16} />} onClick={handlePickFile} disabled={busy !== 'idle'}>
              {t('settings.backup.sourceFile')}
            </Button>
            <Button
              variant="secondary"
              leftIcon={<HardDrive size={16} />}
              onClick={() => {
                void refreshOpfs();
                setOpfsPickerOpen(true);
              }}
              disabled={busy !== 'idle'}
              title={t('settings.backup.sourceOpfs')}
            >
              {t('settings.backup.sourceOpfs')} ({opfsFiles.length})
            </Button>
            <Can action="edit" module="settings">
              <Button
                variant="secondary"
                leftIcon={<RotateCcw size={16} />}
                onClick={() => restoreSummary && setConfirmRestore(true)}
                isLoading={busy === 'restoring'}
                disabled={!restoreSummary || busy !== 'idle'}
              >
                {t('settings.backup.restore')}
              </Button>
            </Can>
          </div>

          {restoreSummary ? (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10 p-4 space-y-1 text-sm">
              <p className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck size={16} />
                {t('settings.backup.verifyOk')}
              </p>
              <p className="text-slate-600 dark:text-slate-300">
                {t('settings.backup.manifestSummary', {
                  tables: restoreSummary.tables,
                  rows: restoreSummary.rows,
                  date: formatDateTime(restoreSummary.createdAt),
                })}
              </p>
              {restoreSummary.encrypted && (
                <div className="pt-2 max-w-sm">
                  <Input
                    label={t('settings.backup.password')}
                    type="password"
                    value={restorePassword}
                    onChange={(e) => setRestorePassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400">{t('settings.backup.noFileSelected')}</p>
          )}
        </div>
      </Card>

      {/* Auto backup (OPFS) */}
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h3 className="text-lg font-semibold">{t('settings.backup.autoTitle')}</h3>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={autoEnabled}
                onChange={handleAutoToggle}
                className="w-5 h-5 accent-primary-600"
                aria-label={t('settings.backup.autoBackup')}
              />
              <span className="text-slate-500 dark:text-slate-400">
                {autoEnabled ? t('settings.backup.typeAuto') : t('settings.backup.typeManual')}
              </span>
            </label>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
            {opfsSupported() ? t('settings.backup.autoDesc') : t('settings.backup.autoUnsupported')}
          </p>
          {lastAutoAt && (
            <p className="text-xs text-slate-400 mb-3">
              {t('settings.backup.lastAutoRun', { date: formatDateTime(lastAutoAt) })}
            </p>
          )}
          {opfsFiles.length > 0 ? (
            <div className="space-y-2">
              {opfsFiles.map((f) => (
                <div
                  key={f.name}
                  className="flex items-center justify-between gap-2 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <HardDrive size={15} className="text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{f.name}</p>
                      <p className="text-xs text-slate-400 tabular">
                        {formatBytes(f.size)} · {formatDateTime(f.modifiedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => handleRestoreOpfs(f)} title={t('settings.backup.restore')}>
                      <RotateCcw size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('settings.backup.driveActionDownload')}
                      onClick={() =>
                        readFromOpfs(f.name)
                          .then((text) => downloadEnvelopeText(f.name, text))
                          .catch((err) => addToast('error', err instanceof Error ? err.message : t('settings.backup.errorToast')))
                      }
                    >
                      <Download size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('settings.common.delete')}
                      onClick={() => deleteFromOpfs(f.name).then(() => refreshOpfs()).catch(() => {})}
                    >
                      <Trash2 size={14} className="text-rose-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">{t('settings.backup.opfsEmpty')}</p>
          )}
        </div>
      </Card>

      {/* Google Drive */}
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              {driveConnected ? (
                <Cloud size={20} className="text-sky-600 dark:text-sky-400" />
              ) : (
                <CloudOff size={20} className="text-slate-400" />
              )}
              {t('settings.backup.driveTitle')}
            </h3>
            {driveConnected ? (
              <Button size="sm" variant="secondary" onClick={handleDriveDisconnect}>
                {t('settings.backup.disconnect')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={handleDriveConnect}
                isLoading={busy === 'drive'}
                disabled={!clientId.trim() || busy !== 'idle'}
              >
                {t('settings.backup.connect')}
              </Button>
            )}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">{t('settings.backup.driveDesc')}</p>
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <div className="flex-1">
              <Input
                label={t('settings.backup.clientId')}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                dir="ltr"
                placeholder="xxxx.apps.googleusercontent.com"
              />
            </div>
            <div className="flex items-end">
              <Button variant="secondary" onClick={handleSaveClientId} disabled={!companyId}>
                {t('settings.common.save')}
              </Button>
            </div>
          </div>
          <p className="text-xs text-slate-400 mb-3">{t('settings.backup.clientIdDesc')}</p>
          {driveConnected && (
            <div className="space-y-2">
              {driveFiles.length === 0 && <p className="text-xs text-slate-400">{t('settings.backup.driveEmpty')}</p>}
              {driveFiles.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-2 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileArchive size={15} className="text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{f.name}</p>
                      <p className="text-xs text-slate-400 tabular">
                        {formatBytes(f.size)} · {formatDateTime(f.modifiedTime)}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" title={t('settings.backup.restore')} onClick={() => handleRestoreDrive(f)}>
                      <RotateCcw size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('settings.backup.driveActionDownload')}
                      onClick={() =>
                        driveClient
                          ?.downloadBackup(f.id)
                          .then((text) => downloadEnvelopeText(f.name.endsWith(BACKUP_FILE_EXTENSION) ? f.name : `${f.name}${BACKUP_FILE_EXTENSION}`, text))
                          .catch((err) => addToast('error', err instanceof Error ? err.message : t('settings.backup.errorToast')))
                      }
                    >
                      <Download size={14} />
                    </Button>
                    <Button size="sm" variant="ghost" title={t('settings.common.delete')} onClick={() => handleDriveDelete(f)}>
                      <Trash2 size={14} className="text-rose-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* History */}
      <Card>
        <div className="p-4">
          <h3 className="font-semibold mb-4">{t('settings.backup.recentTitle')}</h3>
          {history.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">{t('settings.backup.historyEmpty')}</p>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-2 py-2 px-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <FileArchive size={16} className="text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{entry.name}</p>
                      <p className="text-xs text-slate-400 tabular">
                        {formatDateTime(entry.createdAt)} · {formatBytes(entry.size)} ·{' '}
                        {entry.kind === 'auto' ? t('settings.backup.typeAuto') : t('settings.backup.typeManual')} ·{' '}
                        {destinationBadge(entry)}
                        {entry.encrypted ? ` · ${t('settings.backup.encryptedBadge')}` : ''}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('settings.common.delete')}
                    onClick={() => setDeleteTarget(entry)}
                  >
                    <Trash2 size={14} className="text-rose-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <ConfirmDialog
        isOpen={confirmRestore}
        onClose={() => setConfirmRestore(false)}
        onConfirm={handleConfirmRestore}
        title={t('settings.backup.restoreConfirmTitle')}
        message={t('settings.backup.restoreConfirmMessage', { name: restoreText?.name ?? '' })}
        confirmText={t('settings.backup.restore')}
        variant="danger"
      />
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleDeleteHistory(deleteTarget)}
        title={t('settings.backup.deleteConfirmTitle')}
        message={t('settings.backup.deleteConfirmMessage', { name: deleteTarget?.name ?? '' })}
        confirmText={t('settings.common.delete')}
        variant="danger"
      />

      {/* Restore-from-OPFS picker */}
      <Modal
        isOpen={opfsPickerOpen}
        onClose={() => setOpfsPickerOpen(false)}
        title={t('settings.backup.sourceOpfs')}
        size="md"
      >
        {opfsFiles.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">{t('settings.backup.opfsEmpty')}</p>
        ) : (
          <div className="space-y-2">
            {opfsFiles.map((f) => (
              <button
                key={f.name}
                type="button"
                onClick={() => {
                  setOpfsPickerOpen(false);
                  void handleRestoreOpfs(f);
                }}
                className="w-full flex items-center justify-between gap-2 py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-primary-400 transition-colors text-start"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{f.name}</span>
                  <span className="block text-xs text-slate-400 tabular">
                    {formatBytes(f.size)} · {formatDateTime(f.modifiedAt)}
                  </span>
                </span>
                <RotateCcw size={16} className="text-primary-600 dark:text-primary-400 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default BackupPage;
