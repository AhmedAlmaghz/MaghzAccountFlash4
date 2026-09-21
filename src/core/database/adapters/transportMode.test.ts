import { describe, expect, it } from 'vitest';
import { getTransportMode, setTransportMode } from './transportMode';

/** Flag contract: localStorage-backed, main by default, worker only on opt-in. */
describe('transportMode flag', () => {
  it('defaults to main', () => {
    localStorage.removeItem('maghzaccount-pglite-transport');
    expect(getTransportMode()).toBe('main');
  });

  it('round-trips worker opt-in', () => {
    setTransportMode('worker');
    expect(getTransportMode()).toBe('worker');
    setTransportMode('main');
    expect(getTransportMode()).toBe('main');
  });

  it('treats unknown values as main (fail-safe)', () => {
    localStorage.setItem('maghzaccount-pglite-transport', 'turbo');
    expect(getTransportMode()).toBe('main');
    localStorage.removeItem('maghzaccount-pglite-transport');
  });
});
