import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToastStore } from './toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('addToast', () => {
    it('adds a toast to the store', () => {
      const id = useToastStore.getState().addToast('success', 'Test message');
      const toasts = useToastStore.getState().toasts;
      
      expect(toasts).toHaveLength(1);
      expect(toasts[0]).toMatchObject({
        id,
        type: 'success',
        message: 'Test message',
        duration: 4000,
      });
    });

    it('adds toast with custom duration', () => {
      const _id = useToastStore.getState().addToast('error', 'Error', 5000);
      const toasts = useToastStore.getState().toasts;
      
      expect(toasts[0].duration).toBe(5000);
    });

    it('adds multiple toasts', () => {
      useToastStore.getState().addToast('success', 'First');
      useToastStore.getState().addToast('error', 'Second');
      useToastStore.getState().addToast('info', 'Third');
      
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(3);
    });

    it('returns unique IDs', () => {
      const id1 = useToastStore.getState().addToast('success', 'First');
      const id2 = useToastStore.getState().addToast('success', 'Second');
      
      expect(id1).not.toBe(id2);
    });

    it('auto-removes toast after duration', () => {
      useToastStore.getState().addToast('success', 'Test', 3000);
      
      expect(useToastStore.getState().toasts).toHaveLength(1);
      
      vi.advanceTimersByTime(3000);
      
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('does not auto-remove when duration is 0', () => {
      useToastStore.getState().addToast('success', 'Test', 0);
      
      vi.advanceTimersByTime(10000);
      
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
  });

  describe('removeToast', () => {
    it('removes a specific toast by ID', () => {
      const id1 = useToastStore.getState().addToast('success', 'First');
      const id2 = useToastStore.getState().addToast('error', 'Second');
      
      useToastStore.getState().removeToast(id1);
      
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].id).toBe(id2);
    });

    it('does nothing if ID does not exist', () => {
      useToastStore.getState().addToast('success', 'Test');
      
      useToastStore.getState().removeToast('non-existent-id');
      
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
  });

  describe('clearToasts', () => {
    it('removes all toasts', () => {
      useToastStore.getState().addToast('success', 'First');
      useToastStore.getState().addToast('error', 'Second');
      useToastStore.getState().addToast('info', 'Third');
      
      useToastStore.getState().clearToasts();
      
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('works when no toasts exist', () => {
      useToastStore.getState().clearToasts();
      
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });
  });

  describe('toast types', () => {
    it('supports success type', () => {
      useToastStore.getState().addToast('success', 'Success message');
      expect(useToastStore.getState().toasts[0].type).toBe('success');
    });

    it('supports error type', () => {
      useToastStore.getState().addToast('error', 'Error message');
      expect(useToastStore.getState().toasts[0].type).toBe('error');
    });

    it('supports info type', () => {
      useToastStore.getState().addToast('info', 'Info message');
      expect(useToastStore.getState().toasts[0].type).toBe('info');
    });

    it('supports warning type', () => {
      useToastStore.getState().addToast('warning', 'Warning message');
      expect(useToastStore.getState().toasts[0].type).toBe('warning');
    });
  });
});
