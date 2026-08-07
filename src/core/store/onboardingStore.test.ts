import { describe, it, expect, beforeEach } from 'vitest';
import { useOnboardingStore } from './onboardingStore';

describe('onboardingStore', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset();
  });

  it('starts with empty adminPassword and default seedOption', () => {
    const state = useOnboardingStore.getState();
    expect(state.adminPassword).toBe('');
    expect(state.seedOption).toBe('default');
  });

  it('updates adminPassword via setAdminPassword', () => {
    useOnboardingStore.getState().setAdminPassword('secret-123');
    expect(useOnboardingStore.getState().adminPassword).toBe('secret-123');
  });

  it('clears adminPassword on reset', () => {
    useOnboardingStore.getState().setAdminPassword('secret-123');
    useOnboardingStore.getState().reset();
    expect(useOnboardingStore.getState().adminPassword).toBe('');
  });

  it('partialize excludes db password and adminPassword', () => {
    useOnboardingStore.getState().setDbConfig({ password: 'db-secret' });
    useOnboardingStore.getState().setAdminPassword('admin-secret');

    const persisted = JSON.parse(
      JSON.stringify(useOnboardingStore.getState(), (k, v) => {
        if (k === 'password' || k === 'adminPassword') return undefined;
        return v;
      }),
    );

    expect(persisted.dbConfig.password).toBeUndefined();
    expect(persisted.adminPassword).toBeUndefined();
  });
});
