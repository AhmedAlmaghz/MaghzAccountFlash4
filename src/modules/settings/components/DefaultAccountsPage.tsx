import React, { useMemo } from 'react';
import { Settings, CheckCircle, AlertCircle, Factory, ShoppingCart, Briefcase } from 'lucide-react';
import { Card, Button, Table, Badge, Can } from '@/core/ui/components';
import { AccountSelect } from '@/core/ui/components/smart';
import { useDefaultAccounts } from '@/core/hooks/useSettings';
import { DEFAULT_ACCOUNT_FUNCTIONS } from '@/core/types';
import { useAccounts } from '@/modules/accounting/hooks/useAccounting';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';

export const DefaultAccountsPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const { accounts: defaultAccs, isLoading, update, applyTemplate } = useDefaultAccounts(activeCompany?.id || '');
  const { accounts: allAccounts } = useAccounts(activeCompany?.id || '');

  const functionMap = useMemo(() => {
    const map: Record<string, typeof defaultAccs[0]> = {};
    defaultAccs.forEach(a => { map[a.functionKey] = a; });
    return map;
  }, [defaultAccs]);

  const accountName = (accountId?: string | null) => {
    if (!accountId) return null;
    const acc = allAccounts.find(a => a.id === accountId);
    return acc ? `${acc.code} - ${acc.nameAr}` : accountId;
  };

  const handleUpdate = async (id: string, accountId: string | null) => {
    const result = await update(id, accountId);
    if (!result.success) {
      addToast('error', result.error || t('settings.defaultAccounts.updateError'));
    }
  };

  const handleApplyTemplate = async (template: 'trading' | 'manufacturing' | 'services') => {
    const result = await applyTemplate(template);
    if (result.success) {
      addToast('success', t('settings.defaultAccounts.applied'));
    } else {
      addToast('error', result.error || t('settings.defaultAccounts.applyError'));
    }
  };

  const columns = [
    { key: 'functionKey', header: t('settings.defaultAccounts.function'), render: (row: typeof DEFAULT_ACCOUNT_FUNCTIONS[0]) => (
      <div className="flex items-center gap-2">
        {functionMap[row.key]?.isRequired ? (
          <AlertCircle size={14} className="text-rose-500" />
        ) : (
          <CheckCircle size={14} className="text-slate-400" />
        )}
        <span className="font-medium">{row.labelAr}</span>
      </div>
    )},
    { key: 'status', header: t('settings.defaultAccounts.status'), width: '120px', render: (row: typeof DEFAULT_ACCOUNT_FUNCTIONS[0]) => {
      const acc = functionMap[row.key];
      if (acc?.accountId) {
        return <Badge className="bg-emerald-100 text-emerald-700">{t('settings.defaultAccounts.linked')}</Badge>;
      }
      if (row.required) {
        return <Badge className="bg-rose-100 text-rose-700">{t('settings.defaultAccounts.required')}</Badge>;
      }
      return <Badge className="bg-slate-100 text-slate-500">{t('settings.defaultAccounts.optional')}</Badge>;
    }},
    { key: 'account', header: t('settings.defaultAccounts.linkedAccount'), render: (row: typeof DEFAULT_ACCOUNT_FUNCTIONS[0]) => {
      const acc = functionMap[row.key];
      return (
        <div className="min-w-[240px]">
          <AccountSelect
            companyId={activeCompany?.id || ''}
            value={acc?.accountId || ''}
            onChange={async (v) => {
              if (acc) await handleUpdate(acc.id, v || null);
            }}
            size="sm"
            placeholder={row.required ? t('settings.defaultAccounts.selectAccount') : t('settings.defaultAccounts.none')}
          />
        </div>
      );
    }},
    { key: 'current', header: t('settings.defaultAccounts.currentAccount'), width: '200px', render: (row: typeof DEFAULT_ACCOUNT_FUNCTIONS[0]) => {
      const name = accountName(functionMap[row.key]?.accountId);
      return name ? (
        <span className="text-sm text-slate-700 dark:text-slate-200 font-mono">{name}</span>
      ) : (
        <span className="text-sm text-slate-400">—</span>
      );
    }},
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('settings.defaultAccounts.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('settings.defaultAccounts.subtitle')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Can action="edit" module="settings">
            <Button variant="secondary" size="sm" leftIcon={<ShoppingCart size={14} />} onClick={() => handleApplyTemplate('trading')}>{t('settings.defaultAccounts.templateTrading')}</Button>
          </Can>
          <Can action="edit" module="settings">
            <Button variant="secondary" size="sm" leftIcon={<Factory size={14} />} onClick={() => handleApplyTemplate('manufacturing')}>{t('settings.defaultAccounts.templateManufacturing')}</Button>
          </Can>
          <Can action="edit" module="settings">
            <Button variant="secondary" size="sm" leftIcon={<Briefcase size={14} />} onClick={() => handleApplyTemplate('services')}>{t('settings.defaultAccounts.templateServices')}</Button>
          </Can>
        </div>
      </div>

      <Card>
        <Table data={DEFAULT_ACCOUNT_FUNCTIONS} columns={columns} keyExtractor={(row) => row.key} isLoading={isLoading} emptyMessage={t('settings.defaultAccounts.empty')} />
      </Card>
    </div>
  );
};

export default DefaultAccountsPage;
