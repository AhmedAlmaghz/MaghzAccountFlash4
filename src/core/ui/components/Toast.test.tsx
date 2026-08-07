import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastContainer } from './Toast';
import { useToastStore } from '@/core/store/toastStore';

describe('ToastContainer', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('renders nothing when no toasts exist', () => {
    const { container } = render(<ToastContainer />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a single toast', () => {
    useToastStore.getState().addToast('success', 'Test message', 0);
    
    render(<ToastContainer />);
    
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Test message')).toBeInTheDocument();
  });

  it('renders multiple toasts', () => {
    useToastStore.getState().addToast('success', 'First', 0);
    useToastStore.getState().addToast('error', 'Second', 0);
    useToastStore.getState().addToast('info', 'Third', 0);
    
    render(<ToastContainer />);
    
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(3);
  });

  it('displays success icon for success toast', () => {
    useToastStore.getState().addToast('success', 'Success', 0);
    
    render(<ToastContainer />);
    
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('emerald');
  });

  it('displays error icon for error toast', () => {
    useToastStore.getState().addToast('error', 'Error', 0);
    
    render(<ToastContainer />);
    
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('red');
  });

  it('displays info icon for info toast', () => {
    useToastStore.getState().addToast('info', 'Info', 0);
    
    render(<ToastContainer />);
    
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('blue');
  });

  it('displays warning icon for warning toast', () => {
    useToastStore.getState().addToast('warning', 'Warning', 0);
    
    render(<ToastContainer />);
    
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('amber');
  });

  it('removes toast when close button is clicked', () => {
    vi.useFakeTimers();
    useToastStore.getState().addToast('success', 'Test', 0);
    
    render(<ToastContainer />);
    
    expect(screen.getByRole('alert')).toBeInTheDocument();
    
    const closeButton = screen.getByRole('button');
    fireEvent.click(closeButton);
    
    vi.advanceTimersByTime(300);
    
    expect(useToastStore.getState().toasts).toHaveLength(0);
    vi.useRealTimers();
  });

  it('auto-removes toast after duration', () => {
    vi.useFakeTimers();
    
    useToastStore.getState().addToast('success', 'Test', 3000);
    
    render(<ToastContainer />);
    
    expect(screen.getByRole('alert')).toBeInTheDocument();
    
    vi.advanceTimersByTime(3000);
    
    expect(useToastStore.getState().toasts).toHaveLength(0);
    
    vi.useRealTimers();
  });

  it('does not auto-remove when duration is 0', () => {
    vi.useFakeTimers();
    
    useToastStore.getState().addToast('success', 'Test', 0);
    
    render(<ToastContainer />);
    
    vi.advanceTimersByTime(10000);
    
    expect(screen.getByRole('alert')).toBeInTheDocument();
    
    vi.useRealTimers();
  });
});
