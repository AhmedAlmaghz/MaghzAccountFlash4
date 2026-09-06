import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/modules/core/hooks/useCore', () => ({
  useCurrencies: vi.fn(() => ({
    currencies: [
      { id: 'uuid-yer', companyId: 'c1', code: 'YER', name: 'ريال يمني', exchangeRate: 1, isDefault: true, isActive: true },
      { id: 'uuid-usd', companyId: 'c1', code: 'USD', name: 'دولار', exchangeRate: 1500, isDefault: false, isActive: true },
    ],
    isLoading: false,
  })),
}));

vi.mock('@/core/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { CurrencySelect } from './CurrencySelect';

// jsdom has no layout engine — stub scrollIntoView used by SmartSelect.
Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
  value: () => {},
  configurable: true,
});

describe('CurrencySelect (regression: options keyed by code)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays the selected currency code instead of an empty trigger', () => {
    render(<CurrencySelect companyId="c1" value="USD" onChange={() => {}} />);
    expect(screen.getByText(/دولار \(USD\)/)).toBeInTheDocument();
  });

  it('resolves picks to currency codes, not row uuids', () => {
    const onChange = vi.fn();
    render(<CurrencySelect companyId="c1" value="YER" onChange={onChange} />);
    // Open the dropdown via the trigger button
    fireEvent.click(screen.getByText(/ريال يمني \(YER\)/));
    // Pick USD — onChange must receive 'USD' so parents find the rate
    fireEvent.click(screen.getByText(/دولار \(USD\)/));
    expect(onChange).toHaveBeenCalledWith('USD');
  });
});
