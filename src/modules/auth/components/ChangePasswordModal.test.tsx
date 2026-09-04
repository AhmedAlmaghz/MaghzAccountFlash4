import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChangePasswordModal } from './ChangePasswordModal';
import { useAuthStore } from '../store';
import { authApi } from '../api';
import type { User } from '../types';

vi.mock('@/core/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    language: 'ar',
  }),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      changePasswordSelf: vi.fn(),
    },
  };
});

const changePasswordSelf = vi.mocked(authApi.changePasswordSelf);

const admin: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', companyId: 'c1', isActive: true };

function fill(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('auth.changePassword.currentPassword'), { target: { value: current } });
  fireEvent.change(screen.getByLabelText('auth.changePassword.newPassword'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('auth.changePassword.confirmPassword'), { target: { value: confirm } });
}

describe('ChangePasswordModal', () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    useAuthStore.getState().login(admin);
    changePasswordSelf.mockReset().mockResolvedValue({ success: true });
  });

  it('renders nothing when closed', () => {
    const { container } = render(<ChangePasswordModal isOpen={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders current + new + confirm fields when open', () => {
    render(<ChangePasswordModal isOpen onClose={() => {}} />);
    expect(screen.getByText('auth.changePassword.title')).toBeInTheDocument();
    expect(screen.getByLabelText('auth.changePassword.currentPassword')).toBeInTheDocument();
    expect(screen.getByLabelText('auth.changePassword.newPassword')).toBeInTheDocument();
    expect(screen.getByLabelText('auth.changePassword.confirmPassword')).toBeInTheDocument();
  });

  it('blocks mismatched confirmation without calling the API', () => {
    const onClose = vi.fn();
    render(<ChangePasswordModal isOpen onClose={onClose} />);
    fill('CurrentPassword99', 'NewPassword12345', 'Different123456');
    fireEvent.click(screen.getByRole('button', { name: 'settings.common.save' }));
    expect(changePasswordSelf).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('blocks weak new passwords without calling the API', () => {
    render(<ChangePasswordModal isOpen onClose={() => {}} />);
    fill('CurrentPassword99', 'short', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'settings.common.save' }));
    expect(changePasswordSelf).not.toHaveBeenCalled();
  });

  it('submits valid input and closes on success', async () => {
    const onClose = vi.fn();
    render(<ChangePasswordModal isOpen onClose={onClose} />);
    fill('CurrentPassword99', 'NewPassword12345', 'NewPassword12345');
    fireEvent.click(screen.getByRole('button', { name: 'settings.common.save' }));
    expect(changePasswordSelf).toHaveBeenCalledWith('c1', '1', 'CurrentPassword99', 'NewPassword12345');
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('stays open when the server rejects (wrong current password)', async () => {
    changePasswordSelf.mockResolvedValue({ success: false, error: 'كلمة المرور الحالية غير صحيحة' });
    const onClose = vi.fn();
    render(<ChangePasswordModal isOpen onClose={onClose} />);
    fill('WrongPassword99', 'NewPassword12345', 'NewPassword12345');
    fireEvent.click(screen.getByRole('button', { name: 'settings.common.save' }));
    await vi.waitFor(() => expect(changePasswordSelf).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('auth.changePassword.title')).toBeInTheDocument();
  });
});
