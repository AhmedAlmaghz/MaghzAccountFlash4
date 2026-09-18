/**
 * Multi-country tax engine contracts (Phase 3 — FIN track).
 *
 * One file per country under `./countries/` implements `CountryTaxProfile`.
 * Rates, thresholds and phases are DATA — when a tax authority changes the
 * law, only that country's file changes (plus its tests). The engine itself
 * (`engine.ts`) is country-neutral: periods, returns, locks.
 */

export type FilingFrequency = 'monthly' | 'quarterly' | 'annual';

export interface VatRateStructure {
  /** Standard rate applied by default (e.g. 0.15). */
  standard: number;
  /** Reduced rates with their scope labels (may be empty). */
  reduced: Array<{ rate: number; scope: string }>;
  /** Zero-rated categories (exports, …). */
  zeroRated: string[];
  /** Exempt categories (financial, residential lease, …). */
  exempt: string[];
}

export interface RegistrationRules {
  /** Mandatory registration turnover threshold (local currency). */
  mandatoryThreshold: number;
  /** Voluntary registration threshold (local currency). */
  voluntaryThreshold: number;
  /** Currency of the thresholds. */
  currency: string;
}

export interface FilingRules {
  /** Available filing frequencies with their selector rule. */
  frequencies: FilingFrequency[];
  /** Rule picking the frequency (e.g. monthly above annual turnover X). */
  defaultFrequencyNote: string;
}

export interface EInvoicingRules {
  required: boolean;
  /** Phase/stage description (waves, portal, Peppol, …). */
  phases: string;
  /** Machine-checkable document requirements. */
  documentRequirements: string[];
}

export interface CountryTaxProfile {
  /** ISO-2 country code — also the settings key value (`tax.country_code`). */
  countryCode: string;
  countryNameAr: string;
  countryNameEn: string;
  /** IANA timezone used for tax calendars (stored, displayed, used by the return header). */
  timezone: string;
  vat: VatRateStructure;
  registration: RegistrationRules;
  filing: FilingRules;
  eInvoicing: EInvoicingRules;
  /** Free-form statutory notes (withholding, corporate tax, table tax…). */
  notes: string[];
  /** Machine validation of a sales document; returns human-readable issues. */
  validateDocument: (doc: TaxDocument) => string[];
}

/** Minimal document shape the country validators inspect. */
export interface TaxDocument {
  kind: 'sales_invoice' | 'purchase_invoice' | 'sales_return' | 'purchase_return';
  number?: string;
  date?: string;
  sellerTaxNumber?: string | null;
  buyerTaxNumber?: string | null;
  currencyCode?: string;
  subtotal: number;
  vatAmount: number;
  totalAmount: number;
}

export interface TaxPeriod {
  id: string;
  companyId: string;
  countryCode: string;
  periodType: string;
  startDate: string;
  endDate: string;
  status: 'open' | 'closed' | 'filed';
  filedAt?: string | null;
}

export interface VatReturnLine {
  label: string;
  amount: number;
}

export interface VatReturn {
  period: TaxPeriod;
  outputVat: number;
  inputVat: number;
  netPayable: number;
  /** True when the business owes the authority (else refundable/carried). */
  payable: boolean;
  lines: VatReturnLine[];
  currencyCode: string;
}
