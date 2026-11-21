import { afterEach, describe, expect, it } from 'vitest';
import { useOnboardingStore } from './onboardingStore';

describe('onboardingStore — existing-database mode', () => {
  afterEach(() => {
    useOnboardingStore.getState().reset();
  });

  it('sets seedOption to existing and returns to the normal reset default afterwards', () => {
    const { setSeedOption } = useOnboardingStore.getState();
    setSeedOption('existing');
    expect(useOnboardingStore.getState().seedOption).toBe('existing');
    useOnboardingStore.getState().reset();
    expect(useOnboardingStore.getState().seedOption).toBe('default');
  });
});
