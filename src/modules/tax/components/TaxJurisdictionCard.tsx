import React, { useMemo } from 'react';
import { Landmark, Save } from 'lucide-react';
import { Card, Button, Can } from '@/core/ui/components';
import { getCountryProfile, listCountryProfiles } from '../registry';

const COMMON_TIMEZONES = [
  'Asia/Aden',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Qatar',
  'Asia/Kuwait',
  'Asia/Bahrain',
  'Asia/Muscat',
  'Asia/Amman',
  'Asia/Beirut',
  'Asia/Damascus',
  'Asia/Baghdad',
  'Africa/Cairo',
  'Africa/Khartoum',
  'UTC',
];

interface Props {
  t: (key: string) => string;
  taxCountry: string;
  setTaxCountry: (v: string) => void;
  taxTimezone: string;
  setTaxTimezone: (v: string) => void;
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
}

/**
 * Company tax jurisdiction (Phase 3): country select drives the whole tax
 * engine profile — standard rate, registration thresholds, filing cadence
 * and e-invoicing requirements render live below so the choice is explicit.
 */
export const TaxJurisdictionCard: React.FC<Props> = ({
  t,
  taxCountry,
  setTaxCountry,
  taxTimezone,
  setTaxTimezone,
  isDirty,
  isSaving,
  onSave,
}) => {
  const countries = useMemo(() => listCountryProfiles(), []);
  const profile = getCountryProfile(taxCountry);

  return (
    <Card className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-50 flex items-center gap-2">
            <Landmark size={16} /> {t('settings.tax.title')}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('settings.tax.subtitle')}</p>
        </div>
        <Can action="edit" module="settings">
          <Button variant="secondary" leftIcon={<Save size={16} />} onClick={onSave} isLoading={isSaving} disabled={!isDirty}>
            {t('settings.company.save')}
          </Button>
        </Can>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="form-label block mb-1.5">{t('settings.tax.country')}</label>
          <select
            value={profile.countryCode}
            onChange={(e) => {
              const next = getCountryProfile(e.target.value);
              setTaxCountry(next.countryCode);
              setTaxTimezone(next.timezone);
            }}
            className="form-control"
          >
            {countries.map((c) => (
              <option key={c.countryCode} value={c.countryCode}>
                {c.countryNameAr} — {c.countryNameEn}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label block mb-1.5">{t('settings.tax.timezone')}</label>
          <select value={taxTimezone} onChange={(e) => setTaxTimezone(e.target.value)} className="form-control">
            {!COMMON_TIMEZONES.includes(taxTimezone) && <option value={taxTimezone}>{taxTimezone}</option>}
            {COMMON_TIMEZONES.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.tax.standardRate')}</p>
          <p className="font-bold text-lg text-slate-900 dark:text-slate-50">
            {Math.round(profile.vat.standard * 100)}%
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.tax.filing')}: {profile.filing.defaultFrequencyNote}</p>
        </div>
        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.tax.registration')}</p>
          <p className="font-semibold text-slate-900 dark:text-slate-50">
            {profile.registration.mandatoryThreshold > 0
              ? `${profile.registration.mandatoryThreshold.toLocaleString()} ${profile.registration.currency}`
              : '—'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.tax.eInvoicing')}: {profile.eInvoicing.required ? t('settings.tax.required') : t('settings.tax.notRequired')}</p>
        </div>
        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.tax.eInvoicing')}</p>
          <p className="text-xs text-slate-700 dark:text-slate-200 leading-5">{profile.eInvoicing.phases}</p>
        </div>
      </div>
    </Card>
  );
};

export default TaxJurisdictionCard;
