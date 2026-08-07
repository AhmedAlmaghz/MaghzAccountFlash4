import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { CommandPalette, type EntitySource } from './CommandPalette';
import { useAuthStore } from '@/modules/auth/store';
import { useAppStore } from '@/core/store';
import type { User } from '@/modules/auth/types';
import type { LucideIcon } from 'lucide-react';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

function Harness({ sources = [] }: { sources?: EntitySource[] }) {
  const [open, setOpen] = useState(false);
  return (
    <CommandPalette
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      entitySources={sources}
    />
  );
}

const admin: User = { id: '1', username: 'admin', email: 'a@b.com', role: 'admin', isActive: true };
const salesRep: User = { id: '2', username: 'rep', email: 'r@b.com', role: 'sales_rep', isActive: true };

const company = { id: 'c1', name: 'الشركة', currency: 'YER' } as unknown as Parameters<typeof useAppStore.setState>[0]['activeCompany'];

const fakeIcon = (({ size }: { size?: number }) => <span data-size={size} />) as unknown as LucideIcon;

const sources: EntitySource[] = [
  {
    key: 'customers',
    groupKey: 'sidebar.sales.customers',
    path: '/sales/customers',
    icon: fakeIcon,
    fetch: async () => [{ key: 'c1', label: 'شركة الأمل للتجارة', subtitle: '777000000' }],
  },
];

describe('CommandPalette', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    useAuthStore.getState().logout();
    useAuthStore.getState().login(admin);
    useAppStore.setState({ activeCompany: company });
  });

  const getOverlay = () =>
    document.body.querySelector<HTMLElement>('[aria-hidden]');

  it('is hidden when closed', () => {
    render(<Harness />);
    expect(getOverlay()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('opens with Ctrl+K and focuses the search input', async () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(getOverlay()?.getAttribute('aria-hidden')).toBe('false'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('بحث شامل في التطبيق')));
  });

  it('closes with Escape', async () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(getOverlay()?.getAttribute('aria-hidden')).toBe('false'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(getOverlay()?.getAttribute('aria-hidden')).toBe('true'));
  });

  it('filters pages by Arabic query', async () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByLabelText('بحث شامل في التطبيق');
    fireEvent.change(input, { target: { value: 'فواتير' } });
    expect(screen.getByRole('button', { name: /فواتير\s*المبيعات/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /القيود\s*اليومية/i })).not.toBeInTheDocument();
  });

  it('navigates with ArrowDown + Enter', async () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByLabelText('بحث شامل في التطبيق');
    fireEvent.change(input, { target: { value: 'فواتير' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/purchases/invoices'));
  });

  it('navigates with Enter on the first result', async () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByLabelText('بحث شامل في التطبيق');
    fireEvent.change(input, { target: { value: 'فواتير' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/sales/invoices'));
  });

  it('navigates on row click', async () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByLabelText('بحث شامل في التطبيق');
    fireEvent.change(input, { target: { value: 'القيود اليومية' } });
    fireEvent.click(screen.getByRole('button', { name: /القيود اليومية/i }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/accounting/journal'));
  });

  it('hides modules the user cannot access', async () => {
    useAuthStore.getState().login(salesRep);
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await screen.findByLabelText('بحث شامل في التطبيق');
    expect(screen.getByText('المبيعات')).toBeInTheDocument();
    expect(screen.queryByText('الحسابات')).not.toBeInTheDocument();
  });

  it('shows entity results from sources', async () => {
    render(<Harness sources={sources} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByLabelText('بحث شامل في التطبيق');
    fireEvent.change(input, { target: { value: 'أمل' } });
    await waitFor(() => expect(screen.getByText('شركة الأمل للتجارة')).toBeInTheDocument());
  });

  it('navigates to entity module page on click', async () => {
    render(<Harness sources={sources} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByLabelText('بحث شامل في التطبيق');
    fireEvent.change(input, { target: { value: 'أمل' } });
    const row = await screen.findByRole('button', { name: /شركة الأمل للتجارة/i });
    fireEvent.click(row);
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/sales/customers'));
  });

  it('shows empty state when nothing matches', async () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByLabelText('بحث شامل في التطبيق');
    fireEvent.change(input, { target: { value: 'xyzzy' } });
    expect(screen.getByText('لا توجد نتائج مطابقة')).toBeInTheDocument();
  });
});
