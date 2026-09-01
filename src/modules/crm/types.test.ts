import { describe, it, expect } from 'vitest';
import {
  OPPORTUNITY_STAGES,
  OPPORTUNITY_OPEN_STAGES,
  OPPORTUNITY_FINAL_STAGES,
  isValidStageTransition,
  stageTransitionError,
} from './types';

describe('Opportunity stage machine (strict forward + terminal)', () => {
  describe('constants', () => {
    it('exposes all 6 stages in canonical order', () => {
      expect(OPPORTUNITY_STAGES).toEqual(['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost']);
    });
    it('open stages are the 4 non-terminal ones in progression order', () => {
      expect(OPPORTUNITY_OPEN_STAGES).toEqual(['new', 'qualified', 'proposal', 'negotiation']);
    });
    it('final stages are won/lost only', () => {
      expect(OPPORTUNITY_FINAL_STAGES).toEqual(['won', 'lost']);
    });
  });

  describe('forward transitions (allowed)', () => {
    it.each([
      ['new', 'qualified'],
      ['qualified', 'proposal'],
      ['proposal', 'negotiation'],
      ['new', 'negotiation'], // skipping intermediate stages is fine
      ['new', 'won'],
      ['qualified', 'won'],
      ['negotiation', 'won'],
      ['new', 'lost'],
      ['negotiation', 'lost'],
      ['proposal', 'lost'],
    ])('%s → %s is legal', (from, to) => {
      expect(isValidStageTransition(from, to)).toBe(true);
    });
  });

  describe('same-stage (allowed no-op)', () => {
    it.each(OPPORTUNITY_STAGES)('%s → %s (same) is legal', (stage) => {
      expect(isValidStageTransition(stage, stage)).toBe(true);
    });
  });

  describe('backward transitions (rejected)', () => {
    it.each([
      ['qualified', 'new'],
      ['proposal', 'qualified'],
      ['negotiation', 'proposal'],
      ['negotiation', 'new'],
      ['proposal', 'new'],
    ])('%s → %s is illegal (forward only)', (from, to) => {
      expect(isValidStageTransition(from, to)).toBe(false);
    });
  });

  describe('terminal lock (won/lost are final)', () => {
    it.each(OPPORTUNITY_STAGES)('won → %s is rejected', (to) => {
      if (to !== 'won') expect(isValidStageTransition('won', to)).toBe(false);
    });
    it.each(OPPORTUNITY_STAGES)('lost → %s is rejected', (to) => {
      if (to !== 'lost') expect(isValidStageTransition('lost', to)).toBe(false);
    });
    it('won → won (same) is still a no-op allowed', () => {
      // same-stage is a no-op — the API treats it as unchanged
      expect(isValidStageTransition('won', 'won')).toBe(true);
    });
  });

  describe('error messages (Arabic)', () => {
    it('terminal message mentions the lock', () => {
      expect(stageTransitionError('won', 'negotiation')).toMatch(/مقفلة/);
      expect(stageTransitionError('lost', 'new')).toMatch(/مقفلة/);
    });
    it('backward message mentions the illegality', () => {
      expect(stageTransitionError('proposal', 'new')).toMatch(/غير قانوني/);
    });
  });
});
