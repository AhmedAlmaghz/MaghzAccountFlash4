import React, { useState, useEffect, useCallback } from 'react';
import { Sliders, Save, Info } from 'lucide-react';import { Card, Button, Input, Can } from '@/core/ui/components';
import { SettingsHeader } from './SettingsHeader';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { getDbAdapter } from '@/core/database/adapters';
import { logAudit } from '@/core/utils/auditLogger';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { DEFAULT_HR_POLICY } from '@/modules/hr/payrollEngine';

interface PolicyFields {
  annualDays: string;
  sickDays: string;
  emergencyDays: string;
  standardWorkHours: string;
  lateGraceMinutes: string;
  overtimeRate: string;
  eosFirstYearsMultiplier: string;
  eosBeyondYearsMultiplier: string;
}

const POLICY_KEYS: Array<{ field: keyof PolicyFields; key: string; fallback: string }> = [
  { field: 'annualDays', key: 'hr.leave.annualDays', fallback: String(DEFAULT_HR_POLICY.annualLeaveDays) },
  { field: 'sickDays', key: 'hr.leave.sickDays', fallback: String(DEFAULT_HR_POLICY.sickLeaveDays) },
  { field: 'emergencyDays', key: 'hr.leave.emergencyDays', fallback: String(DEFAULT_HR_POLICY.emergencyLeaveDays) },
  { field: 'standardWorkHours', key: 'hr.standardWorkHours', fallback: String(DEFAULT_HR_POLICY.standardWorkHours) },
  { field: 'lateGraceMinutes', key: 'hr.lateGraceMinutes', fallback: String(DEFAULT_HR_POLICY.lateGraceMinutes) },
  { field: 'overtimeRate', key: 'hr.overtimeRate', fallback: String(DEFAULT_HR_POLICY.overtimeRate) },
  { field: 'eosFirstYearsMultiplier', key: 'hr.eos.firstYearsMultiplier', fallback: String(DEFAULT_HR_POLICY.eosFirstYearsMultiplier) },
  { field: 'eosBeyondYearsMultiplier', key: 'hr.eos.beyondYearsMultiplier', fallback: String(DEFAULT_HR_POLICY.eosBeyondYearsMultiplier) },
];

export const HrSettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const user = useAuthStore((state) => state.user);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<PolicyFields>({
    annualDays: '21',
    sickDays: '30',
    emergencyDays: '30',
    standardWorkHours: '8',
    lateGraceMinutes: '15',
    overtimeRate: '1.5',
    eosFirstYearsMultiplier: '0.5',
    eosBeyondYearsMultiplier: '1',
  });

  const load = useCallback(async () => {
    if (!activeCompany?.id) return;
    setIsLoading(true);
    try {
      const adapter = await getDbAdapter();
      const result = await adapter.query<{ key: string; value: string }>(
        `SELECT key, value FROM settings WHERE company_id = $1 AND key LIKE 'hr.%'`,
        [activeCompany.id]
      );
      if (result.success && result.rows) {
        const byKey = new Map(result.rows.map((r) => [r.key, r.value]));
        setForm((prev) => {
          const next = { ...prev };
          for (const def of POLICY_KEYS) {
            const v = byKey.get(def.key);
            if (v !== undefined && v !== '' && !Number.isNaN(Number(v))) next[def.field] = v;
          }
          return next;
        });
      }
    } catch {
      // defaults remain
    } finally {
      setIsLoading(false);
    }
  }, [activeCompany?.id]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!activeCompany?.id) return;
    // Validate: all numeric, positive where required
    for (const def of POLICY_KEYS) {
      const v = Number(form[def.field]);
      if (Number.isNaN(v) || v < 0) {
        addToast('error', t('hr.policy.invalidNumber'));
        return;
      }
    }
    if (Number(form.standardWorkHours) <= 0) {
      addToast('error', t('hr.policy.invalidNumber'));
      return;
    }
    setIsSaving(true);
    try {
      const adapter = await getDbAdapter();
      for (const def of POLICY_KEYS) {
        await adapter.query(
          `INSERT INTO settings (id, company_id, key, value, category) VALUES ($1, $2, $3, $4, 'hr')
           ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [crypto.randomUUID(), activeCompany.id, def.key, form[def.field]]
        );
      }
      await logAudit({
        userId: user?.id || 'system',
        username: user?.username,
        action: 'update',
        tableName: 'settings',
        recordId: 'hr-policies',
        recordLabel: 'hr.policy',
        companyId: activeCompany.id,
      });
      addToast('success', t('hr.policy.saved'));
    } catch {
      addToast('error', t('common.error'));
    } finally {
      setIsSaving(false);
    }
  };

  const num = (v: string) => (Number.isNaN(Number(v)) || Number(v) <= 0 ? undefined : Number(v));

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <SettingsHeader
        icon={Sliders}
        title={t('hr.policy.title')}
        subtitle={t('hr.policy.subtitle')}
      />

      <div className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>{t('hr.policy.hint')}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Leave balances */}
        <Card noPadding className="overflow-hidden">
          <div className="bg-gradient-to-br from-violet-600 to-violet-700 text-white p-4">
            <h3 className="font-bold text-sm">{t('hr.policy.leaveTitle')}</h3>
          </div>
          <div className="p-4 space-y-4">
            <Input
              label={t('hr.policy.annualDays')}
              type="number"
              value={form.annualDays}
              onChange={(e) => setForm((p) => ({ ...p, annualDays: e.target.value }))}
              disabled={isLoading}
            />
            <Input
              label={t('hr.policy.sickDays')}
              type="number"
              value={form.sickDays}
              onChange={(e) => setForm((p) => ({ ...p, sickDays: e.target.value }))}
              disabled={isLoading}
            />
            <Input
              label={t('hr.policy.emergencyDays')}
              type="number"
              value={form.emergencyDays}
              onChange={(e) => setForm((p) => ({ ...p, emergencyDays: e.target.value }))}
              disabled={isLoading}
            />
            <p className="text-[11px] text-slate-400">
              {t('hr.leaves.unpaidLabel')}: {t('hr.leaves.uncapped')}
            </p>
          </div>
        </Card>

        {/* Work & overtime */}
        <Card noPadding className="overflow-hidden">
          <div className="bg-gradient-to-br from-sky-600 to-sky-700 text-white p-4">
            <h3 className="font-bold text-sm">{t('hr.policy.workTitle')}</h3>
          </div>
          <div className="p-4 space-y-4">
            <Input
              label={t('hr.policy.standardWorkHours')}
              type="number"
              value={form.standardWorkHours}
              onChange={(e) => setForm((p) => ({ ...p, standardWorkHours: e.target.value }))}
              disabled={isLoading}
            />
            <Input
              label={t('hr.policy.lateGraceMinutes')}
              type="number"
              value={form.lateGraceMinutes}
              onChange={(e) => setForm((p) => ({ ...p, lateGraceMinutes: e.target.value }))}
              disabled={isLoading}
            />
            <Input
              label={t('hr.policy.overtimeRate')}
              type="number"
              value={form.overtimeRate}
              onChange={(e) => setForm((p) => ({ ...p, overtimeRate: e.target.value }))}
              disabled={isLoading}
            />
          </div>
        </Card>

        {/* End of service */}
        <Card noPadding className="overflow-hidden">
          <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 text-white p-4">
            <h3 className="font-bold text-sm">{t('hr.policy.eosTitle')}</h3>
          </div>
          <div className="p-4 space-y-4">
            <Input
              label={t('hr.policy.eosFirstYearsMultiplier')}
              type="number"
              value={form.eosFirstYearsMultiplier}
              onChange={(e) => setForm((p) => ({ ...p, eosFirstYearsMultiplier: e.target.value }))}
              disabled={isLoading}
            />
            <Input
              label={t('hr.policy.eosBeyondYearsMultiplier')}
              type="number"
              value={form.eosBeyondYearsMultiplier}
              onChange={(e) => setForm((p) => ({ ...p, eosBeyondYearsMultiplier: e.target.value }))}
              disabled={isLoading}
            />
            <div className="text-[11px] text-slate-400 leading-relaxed">
              {t('hr.eos.previewTitle')}: {num(form.eosFirstYearsMultiplier ?? '0')} × 5 + {num(form.eosBeyondYearsMultiplier ?? '0')} × (n − 5)
            </div>
          </div>
        </Card>
      </div>

      <div className="flex justify-end">
        <Can action="edit" module="settings">
          <Button
            variant="primary"
            leftIcon={<Save size={16} />}
            onClick={handleSave}
            disabled={isSaving || isLoading || !activeCompany?.id}
          >
            {isSaving ? t('settings.common.saving') : t('hr.policy.save')}
          </Button>
        </Can>
      </div>
    </div>
  );
};

export default HrSettingsPage;
