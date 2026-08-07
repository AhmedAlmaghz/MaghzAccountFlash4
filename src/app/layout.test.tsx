import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { Sidebar, Header, AppLayout } from './layout';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import type { User } from '@/modules/auth/types';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/' }),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
    Outlet: () => <div data-testid="outlet">Outlet Content</div>,
  };
});

vi.mock('@/core/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('Sidebar', () => {
  beforeEach(() => {
    useAppStore.setState({ sidebarOpen: true });
    useAuthStore.getState().logout();
  });

  it('renders sidebar with logo', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    expect(screen.getByText('appSubtitle')).toBeInTheDocument();
  });

  it('renders collapsed sidebar without text', () => {
    useAppStore.setState({ sidebarOpen: false });
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    const { container } = render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    const aside = container.querySelector('aside');
    expect(aside).toHaveClass('w-16');
  });

  it('toggles sidebar on button click', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    const toggleButton = screen.getByRole('button', { name: /header.collapseSidebar/i });
    fireEvent.click(toggleButton);

    expect(useAppStore.getState().sidebarOpen).toBe(false);
  });

  it('renders menu items for admin user', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    expect(screen.getByText('sidebar.dashboard')).toBeInTheDocument();
    expect(screen.getByText('sidebar.accounting.title')).toBeInTheDocument();
    expect(screen.getByText('sidebar.sales.title')).toBeInTheDocument();
  });

  it('hides menu items user cannot access', () => {
    const user: User = { id: '1', username: 'viewer', email: 'v@b.com', role: 'viewer', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    expect(screen.getByText('sidebar.dashboard')).toBeInTheDocument();
    expect(screen.queryByText('sidebar.settings.title')).not.toBeInTheDocument();
  });
});

describe('Header', () => {
  beforeEach(() => {
    useAppStore.setState({ 
      theme: 'light', 
      language: 'ar',
      activeCompany: { id: 'c1', name: 'Test Company', currency: 'YER' }
    });
    useAuthStore.getState().logout();
  });

  it('renders company name when active company exists', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    expect(screen.getByText('Test Company')).toBeInTheDocument();
  });

  it('renders user info when logged in', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('(admin)')).toBeInTheDocument();
  });

  it('does not render user info when not logged in', () => {
    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    expect(screen.queryByText('admin')).not.toBeInTheDocument();
  });

  it('toggles theme on button click', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    const themeButton = screen.getByRole('button', { name: /header.darkMode/i });
    fireEvent.click(themeButton);

    expect(useAppStore.getState().theme).toBe('dark');
  });

  it('toggles language on button click', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    const langButton = screen.getByRole('button', { name: /header.switchToEnglish/i });
    fireEvent.click(langButton);

    expect(useAppStore.getState().language).toBe('en');
  });

  it('logs out on logout button click', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    const logoutButton = screen.getByRole('button', { name: /header.logout/i });
    fireEvent.click(logoutButton);

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});

describe('AppLayout', () => {
  beforeEach(() => {
    useAppStore.setState({ 
      theme: 'light', 
      language: 'ar',
      activeCompany: null,
      sidebarOpen: true 
    });
    useAuthStore.getState().logout();
  });

  it('renders sidebar and header', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <AppLayout />
      </BrowserRouter>
    );

    expect(screen.getByText('appSubtitle')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('renders outlet content', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <AppLayout />
      </BrowserRouter>
    );

    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('tracks user activity when authenticated', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <AppLayout />
      </BrowserRouter>
    );

    const before = Date.now();
    fireEvent.mouseDown(window);
    const after = Date.now();

    const activityTime = useAuthStore.getState().lastActivityAt;
    expect(activityTime).toBeGreaterThanOrEqual(before);
    expect(activityTime).toBeLessThanOrEqual(after);
  });

  it('does not track activity when not authenticated', () => {
    render(
      <BrowserRouter>
        <AppLayout />
      </BrowserRouter>
    );

    const initialActivity = useAuthStore.getState().lastActivityAt;
    fireEvent.mouseDown(window);
    const afterActivity = useAuthStore.getState().lastActivityAt;

    expect(initialActivity).toBeNull();
    expect(afterActivity).toBeNull();
  });
});
