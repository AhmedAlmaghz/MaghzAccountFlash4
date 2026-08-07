import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOwnerFilter } from '@/core/utils/useOwnerFilter';
import { useAuthStore } from '@/modules/auth/store';
import type { User } from '@/modules/auth/types';

const initialState = useAuthStore.getState();

interface TestDoc {
  id: string;
  createdBy?: string;
  name: string;
}

const sampleData: TestDoc[] = [
  { id: '1', createdBy: 'user-1', name: 'Doc 1' },
  { id: '2', createdBy: 'user-2', name: 'Doc 2' },
  { id: '3', createdBy: 'user-1', name: 'Doc 3' },
  { id: '4', createdBy: 'user-3', name: 'Doc 4' },
  { id: '5', name: 'Doc 5 (no createdBy)' },
];

describe('useOwnerFilter', () => {
  beforeEach(() => {
    useAuthStore.setState(initialState, true);
    localStorage.clear();
  });

  it('admin sees all documents (no filter)', () => {
    useAuthStore.setState({
      user: { id: 'admin-1', role: 'admin', username: 'admin', isActive: true } as User,
      permissions: ['sales.view'],
    });

    const { result } = renderHook(() => useOwnerFilter(sampleData, 'sales'));
    expect(result.current.filtered).toHaveLength(5);
    expect(result.current.isOwnOnly).toBe(false);
    expect(result.current.showToggle).toBe(false);
  });

  it('user with .own only sees their documents plus system/agent rows (forced filter)', () => {
    useAuthStore.setState({
      user: { id: 'user-1', role: 'sales_rep', username: 'rep', isActive: true } as User,
      permissions: ['sales.own', 'sales.create'],
    });

    const { result } = renderHook(() => useOwnerFilter(sampleData, 'sales'));
    expect(result.current.filtered).toHaveLength(3);
    expect(result.current.filtered.map(d => d.id)).toEqual(['1', '3', '5']);
    expect(result.current.isOwnOnly).toBe(true);
    expect(result.current.showToggle).toBe(false);
  });

  it('user with .view gets toggle option', () => {
    useAuthStore.setState({
      user: { id: 'user-1', role: 'manager', username: 'mgr', isActive: true } as User,
      permissions: ['sales.view', 'sales.own', 'sales.create'],
    });

    const { result } = renderHook(() => useOwnerFilter(sampleData, 'sales'));
    expect(result.current.showToggle).toBe(true);
    expect(result.current.isOwnOnly).toBe(false);
    expect(result.current.filtered).toHaveLength(5);
  });

  it('toggle switches between all and own-only', () => {
    useAuthStore.setState({
      user: { id: 'user-1', role: 'manager', username: 'mgr', isActive: true } as User,
      permissions: ['sales.view', 'sales.own'],
    });

    const { result } = renderHook(() => useOwnerFilter(sampleData, 'sales'));
    expect(result.current.filtered).toHaveLength(5);

    act(() => {
      result.current.toggleOwnOnly(true);
    });

    expect(result.current.isOwnOnly).toBe(true);
    expect(result.current.filtered).toHaveLength(3);

    act(() => {
      result.current.toggleOwnOnly(false);
    });

    expect(result.current.isOwnOnly).toBe(false);
    expect(result.current.filtered).toHaveLength(5);
  });

  it('persists toggle state in localStorage', () => {
    useAuthStore.setState({
      user: { id: 'user-1', role: 'manager', username: 'mgr', isActive: true } as User,
      permissions: ['sales.view', 'sales.own'],
    });

    const { result } = renderHook(() => useOwnerFilter(sampleData, 'sales'));

    act(() => {
      result.current.toggleOwnOnly(true);
    });

    expect(localStorage.getItem('owner_filter_sales')).toBe('true');
  });

  it('restores toggle state from localStorage on remount', () => {
    useAuthStore.setState({
      user: { id: 'user-1', role: 'manager', username: 'mgr', isActive: true } as User,
      permissions: ['sales.view', 'sales.own'],
    });
    localStorage.setItem('owner_filter_sales', 'true');

    const { result } = renderHook(() => useOwnerFilter(sampleData, 'sales'));
    expect(result.current.isOwnOnly).toBe(true);
    expect(result.current.filtered).toHaveLength(3);
  });

  it('handles empty data', () => {
    useAuthStore.setState({
      user: { id: 'user-1', role: 'sales_rep', username: 'rep', isActive: true } as User,
      permissions: ['sales.own'],
    });

    const { result } = renderHook(() => useOwnerFilter<TestDoc>([], 'sales'));
    expect(result.current.filtered).toHaveLength(0);
  });

  it('includes agent-created rows (no createdBy) when owner-filtering is active', () => {
    useAuthStore.setState({
      user: { id: 'user-2', role: 'sales_rep', username: 'rep', isActive: true } as User,
      permissions: ['sales.own'],
    });

    const docs: TestDoc[] = [
      { id: 'a', createdBy: 'user-2', name: 'Mine' },
      { id: 'b', name: 'Agent-created' },
      { id: 'c', createdBy: 'user-1', name: 'Someone else' },
    ];

    const { result } = renderHook(() => useOwnerFilter(docs, 'sales'));
    expect(result.current.isOwnOnly).toBe(true);
    expect(result.current.filtered.map(d => d.id)).toEqual(['a', 'b']);
  });
});

