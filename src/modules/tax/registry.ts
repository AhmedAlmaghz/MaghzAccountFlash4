/**
 * Country registry (Phase 3). Every supported tax jurisdiction registers
 * exactly once here. Unknown codes fall back to YE (zero-rate) — the engine
 * never crashes on an unconfigured country, it just charges no VAT.
 */
import type { CountryTaxProfile } from './types';
import { saProfile } from './countries/sa';
import { aeProfile } from './countries/ae';
import { egProfile } from './countries/eg';
import { yeProfile } from './countries/ye';

const REGISTRY = new Map<string, CountryTaxProfile>([
  [saProfile.countryCode, saProfile],
  [aeProfile.countryCode, aeProfile],
  [egProfile.countryCode, egProfile],
  [yeProfile.countryCode, yeProfile],
]);

export const DEFAULT_COUNTRY_CODE = 'YE';

export function getCountryProfile(code?: string | null): CountryTaxProfile {
  const key = String(code || '').trim().toUpperCase();
  return REGISTRY.get(key) || yeProfile;
}

export function listCountryProfiles(): CountryTaxProfile[] {
  return [...REGISTRY.values()];
}

export function isSupportedCountry(code?: string | null): boolean {
  return REGISTRY.has(String(code || '').trim().toUpperCase());
}
