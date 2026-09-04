import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { UserMenu } from './UserMenu';
import { useAuthStore } from '../store';
import { useAppStore } from '@/core/store';
import type { User } from '../types';

vi.mock('@/core/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    language: 'ar',
  }),
}));

const admin: User = { id: '1', username: 'salem', email: 'salem@x.com', role: 'manager', isActive: true };

function renderMenu() {
  return render(
    <BrowserRouter>
      <UserMenu />
    </BrowserRouter>,
  );
}

describe('UserMenu', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    useAppStore.setState({ theme: 'light', language: 'ar' });
  });

  it('renders nothing when not logged in', () => {
    const { container } = renderMenu();
    expect(container).toBeEmptyDOMElement();
  });

  it('avatar button shows the photo when the user has one', () => {
    useAuthStore.getState().login({ ...admin, photoUrl: 'data:image/png;base64,AAA' });
    renderMenu();
    const img = screen.getByRole('button', { name: /header\.userMenu\.openMenu/i }).querySelector('img');
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,AAA');
  });

  it('avatar button falls back to the initial when there is no photo', () => {
    useAuthStore.getState().login(admin);
    renderMenu();
    const trigger = screen.getByRole('button', { name: /header\.userMenu\.openMenu/i });
    expect(trigger.textContent).toContain('S');
    expect(trigger.querySelector('img')).toBeNull();
  });

  it('opens the menu revealing name, email and all sections', () => {
    useAuthStore.getState().login(admin);
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /header\.userMenu\.openMenu/i }));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('salem')).toBeInTheDocument();
    expect(screen.getByText('salem@x.com')).toBeInTheDocument();
    // language + appearance + actions
    expect(screen.getByRole('menuitemradio', { name: /header\.userMenu\.arabic/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /header\.userMenu\.dark/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /header\.userMenu\.profile/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /header\.userMenu\.changePassword/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /header\.userMenu\.settings/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /header\.userMenu\.logout/i })).toBeInTheDocument();
  });

  it('opens the profile modal from the menu', () => {
    useAuthStore.getState().login(admin);
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /header\.userMenu\.openMenu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /header\.userMenu\.profile/i }));
    expect(screen.getByText('auth.profile.title')).toBeInTheDocument();
  });

  it('opens the change-password modal from the menu', () => {
    useAuthStore.getState().login(admin);
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /header\.userMenu\.openMenu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /header\.userMenu\.changePassword/i }));
    expect(screen.getByText('auth.changePassword.title')).toBeInTheDocument();
  });

  it('logs out and navigates to login', () => {
    useAuthStore.getState().login(admin);
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /header\.userMenu\.openMenu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /header\.userMenu\.logout/i }));
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
