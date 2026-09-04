import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppBrand } from './AppBrand';
import { APP_VERSION_LABEL } from '@/core/brand';
import ar from '@/core/i18n/ar.json';

describe('AppBrand (unified name + icon + dynamic version)', () => {
  it('full variant renders the app name and the dynamic version below it', () => {
    render(<AppBrand variant="full" />);
    expect(screen.getByText(ar.appName)).toBeInTheDocument();
    expect(screen.getByText(APP_VERSION_LABEL)).toBeInTheDocument();
  });

  it('login variant renders name, subtitle and version', () => {
    render(<AppBrand variant="login" />);
    expect(screen.getByText(ar.appName)).toBeInTheDocument();
    expect(screen.getByText(ar.appSubtitle)).toBeInTheDocument();
    expect(screen.getByText(APP_VERSION_LABEL)).toBeInTheDocument();
  });

  it('compact variant exposes name + version via accessible label', () => {
    render(<AppBrand variant="compact" />);
    expect(
      screen.getByLabelText(`${ar.appName} ${APP_VERSION_LABEL}`),
    ).toBeInTheDocument();
  });
});
