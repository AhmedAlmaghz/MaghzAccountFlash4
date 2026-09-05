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
    Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
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

    expect(screen.getByText('appName')).toBeInTheDocument();
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
    expect(aside).toHaveClass('w-[4.5rem]');
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

  it('section titles link to landing pages and expand children on click', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    const salesLink = screen.getByText('sidebar.sales.title').closest('a');
    expect(salesLink).toHaveAttribute('href', '/sales');
    // Children are hidden until the section is opened
    expect(screen.queryByText('sidebar.sales.invoices')).not.toBeInTheDocument();
    fireEvent.click(salesLink!);
    expect(screen.getByText('sidebar.sales.invoices')).toBeInTheDocument();
  });

  it('chevron button toggles children without following the section link', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    const salesLink = screen.getByText('sidebar.sales.title').closest('a');
    const chevron = salesLink!.querySelector('button');
    expect(chevron).toBeInTheDocument();
    fireEvent.click(chevron!);
    expect(screen.getByText('sidebar.sales.invoices')).toBeInTheDocument();
    fireEvent.click(chevron!);
    expect(screen.queryByText('sidebar.sales.invoices')).not.toBeInTheDocument();
  });

  it('settings section includes the database link', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Sidebar />
      </BrowserRouter>
    );

    const settingsLink = screen.getByText('sidebar.settings.title').closest('a');
    fireEvent.click(settingsLink!);
    const dbLink = screen.getByText('sidebar.settings.database').closest('a');
    expect(dbLink).toHaveAttribute('href', '/settings/database');
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

  it('renders the company logo image when logoUrl exists (all screens and devices)', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);
    useAppStore.setState({
      activeCompany: { id: 'c1', name: 'Test Company', currency: 'YER', logoUrl: 'data:image/png;base64,AAA' },
    });

    const { container } = render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    // No responsive-hiding class: the chip must survive phone widths too.
    const chip = screen.getByText('Test Company').closest('div');
    expect(chip?.className).not.toMatch(/hidden/);
    expect(container.querySelector('img[alt="header.companyLogo"]')).toHaveAttribute(
      'src',
      'data:image/png;base64,AAA',
    );
  });

  it('renders avatar button when logged in (identity lives inside the menu)', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    expect(screen.getByRole('button', { name: /header\.userMenu\.openMenu/i })).toBeInTheDocument();
    // Name/email are hidden until the menu opens
    expect(screen.queryByText('admin')).not.toBeInTheDocument();
  });

  it('opens the user menu showing name and email', () => {
    const user: User = { id: '1', username: 'salem', email: 'salem@x.com', role: 'manager', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /header\.userMenu\.openMenu/i }));

    expect(screen.getByText('salem')).toBeInTheDocument();
    expect(screen.getByText('salem@x.com')).toBeInTheDocument();
  });

  it('does not render user menu when not logged in', () => {
    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    expect(screen.queryByRole('button', { name: /header\.userMenu\.openMenu/i })).not.toBeInTheDocument();
  });

  it('toggles theme from inside the user menu', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /header\.userMenu\.openMenu/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /header\.userMenu\.dark/i }));

    expect(useAppStore.getState().theme).toBe('dark');
  });

  it('toggles language from inside the user menu', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /header\.userMenu\.openMenu/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /header\.userMenu\.english/i }));

    expect(useAppStore.getState().language).toBe('en');
  });

  it('logs out from inside the user menu', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /header\.userMenu\.openMenu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /header\.userMenu\.logout/i }));

    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('renders home and AI assistant shortcuts', () => {
    const user: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
    useAuthStore.getState().login(user);

    render(
      <BrowserRouter>
        <Header />
      </BrowserRouter>
    );

    expect(screen.getByRole('link', { name: /header\.home/i })).toHaveAttribute('href', '/');
    // admin bypasses all permission checks, so the AI shortcut is visible
    expect(screen.getByRole('link', { name: /header\.aiAssistant/i })).toHaveAttribute('href', '/ai');
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

    // Sidebar (desktop) + MobileDrawer (closed but rendered) both carry the unified brand
    expect(screen.getAllByText('appName').length).toBeGreaterThan(0);
    // Identity (username) lives inside the avatar menu, not on the surface
    expect(screen.getByRole('button', { name: /header\.userMenu\.openMenu/i })).toBeInTheDocument();
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
