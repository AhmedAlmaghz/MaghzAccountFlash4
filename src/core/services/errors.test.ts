import { describe, it, expect } from 'vitest';
import {
  ok,
  fail,
  notFound,
  permissionDenied,
  invalidState,
  preconditionFailed,
  conflict,
  wrap,
  assert,
  ServiceError,
} from './errors';

describe('errors', () => {
  describe('ok', () => {
    it('returns a success result with data', () => {
      const result = ok(42);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(42);
      }
    });
  });

  describe('fail', () => {
    it('returns a failure result with error message', () => {
      const result = fail('something broke');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('something broke');
      }
    });

    it('includes error code when provided', () => {
      const result = fail('nope', 'NOT_FOUND');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('notFound', () => {
    it('returns NOT_FOUND result with entity name', () => {
      const result = notFound('الفاتورة');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('NOT_FOUND');
        expect(result.error).toContain('الفاتورة');
      }
    });
  });

  describe('permissionDenied', () => {
    it('returns PERMISSION_DENIED result', () => {
      const result = permissionDenied('sales.post');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('PERMISSION_DENIED');
        expect(result.error).toContain('sales.post');
      }
    });

    it('uses default action when omitted', () => {
      const result = permissionDenied();
      if (!result.success) {
        expect(result.error).toContain('هذه العملية');
      }
    });
  });

  describe('invalidState', () => {
    it('returns INVALID_STATE result', () => {
      const result = invalidState('bad state');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('INVALID_STATE');
        expect(result.error).toBe('bad state');
      }
    });
  });

  describe('preconditionFailed', () => {
    it('returns PRECONDITION_FAILED result', () => {
      const result = preconditionFailed('nope');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('PRECONDITION_FAILED');
      }
    });
  });

  describe('conflict', () => {
    it('returns CONFLICT result', () => {
      const result = conflict('duplicate');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('CONFLICT');
      }
    });
  });

  describe('wrap', () => {
    it('wraps a successful async operation', async () => {
      const result = await wrap(async () => 'hello');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('hello');
      }
    });

    it('wraps a rejected async operation', async () => {
      const result = await wrap(async () => {
        throw new Error('boom');
      }, 'testContext');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('boom');
        expect(result.code).toBe('UNKNOWN');
      }
    });

    it('preserves ServiceError code', async () => {
      const result = await wrap(async () => {
        throw new ServiceError('nope', 'NOT_FOUND');
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe('NOT_FOUND');
      }
    });

    it('wraps non-Error rejections', async () => {
      const result = await wrap(async () => {
        throw 'string error';
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('string error');
      }
    });
  });

  describe('assert', () => {
    it('does not throw when condition is truthy', () => {
      expect(() => assert(true, 'should not throw')).not.toThrow();
    });

    it('throws ServiceError when condition is falsy', () => {
      expect(() => assert(false, 'should throw')).toThrow(ServiceError);
      expect(() => assert(false, 'should throw')).toThrow('should throw');
    });

    it('throws ServiceError with PRECONDITION_FAILED code', () => {
      try {
        assert(false, 'fail');
      } catch (e) {
        expect(e).toBeInstanceOf(ServiceError);
        expect((e as ServiceError).code).toBe('PRECONDITION_FAILED');
      }
    });
  });
});
