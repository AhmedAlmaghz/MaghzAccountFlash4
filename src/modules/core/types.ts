export interface Company {
  id: string;
  name: string;
  nameEn?: string;
  currency: string;
  taxNumber?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  fiscalYearStart?: string;
  dateFormat?: string;
  decimalPlaces?: number;
  calendar?: 'gregorian' | 'hijri';
  createdAt?: string;
  updatedAt?: string;
}

export interface Currency {
  id: string;
  companyId: string;
  code: string;
  name: string;
  symbol?: string;
  exchangeRate: number;
  isDefault: boolean;
  isActive: boolean;
}

export interface VatSetting {
  id: string;
  companyId: string;
  vatRate: number;
  vatNumber?: string;
  isInclusive: boolean;
  isActive: boolean;
}

export interface Branch {
  id: string;
  companyId: string;
  name: string;
  code?: string;
  address?: string;
  isActive: boolean;
}

export interface Setting {
  id: string;
  companyId: string;
  key: string;
  value?: string;
  category: string;
}
