import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { BackupPage } from './BackupPage';

vi.mock('@/core/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (!params) return key;
      return `${key} ${JSON.stringify(params)}`;
    },
    language: 'ar',
  }),
}));

import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { User } from '@/modules/auth/types';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(async () => ({
    query: vi.fn(async () => ({ success: true, rows: [] })),
    transaction: vi.fn(async () => ({ success: true })),
  })),
  isElectronPg: vi.fn(() => false),
}));

const admin: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };

function renderPage() {
  return render(
    <BrowserRouter>
      <BackupPage />
    </BrowserRouter>,
  );
}

describe('BackupPage', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().logout();
    useAuthStore.getState().login(admin);
    useAppStore.setState({
      activeCompany: { id: 'c1', name: 'Test Company', currency: 'YER' },
    });
  });

  it('renders status, create, restore, auto, drive and history sections', () => {
    renderPage();
    expect(screen.getByText('settings.backup.lastBackup')).toBeInTheDocument();
    expect(screen.getByText('settings.backup.createTitle')).toBeInTheDocument();
    expect(screen.getByText('settings.backup.restoreTitle')).toBeInTheDocument();
    expect(screen.getByText('settings.backup.autoTitle')).toBeInTheDocument();
    expect(screen.getByText('settings.backup.driveTitle')).toBeInTheDocument();
    expect(screen.getByText('settings.backup.recentTitle')).toBeInTheDocument();
  });

  it('switches destination to Drive and reveals encryption fields on demand', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /settings\.backup\.destDrive/ }));
    expect(screen.getByRole('button', { name: /settings\.backup\.destDrive/ })).toHaveAttribute('aria-pressed', 'true');

    expect(screen.queryByLabelText('settings.backup.password')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('settings.backup.encrypt'));
    expect(screen.getByLabelText('settings.backup.password')).toBeInTheDocument();
    expect(screen.getByLabelText('settings.backup.confirmPassword')).toBeInTheDocument();
  });

  it('shows an empty-history message when nothing is recorded', () => {
    renderPage();
    expect(screen.getByText('settings.backup.historyEmpty')).toBeInTheDocument();
  });
});
