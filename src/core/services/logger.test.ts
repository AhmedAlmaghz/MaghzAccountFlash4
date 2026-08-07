import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, logError, type LogEntry } from './logger';

describe('logger', () => {
  let captured: LogEntry[];
  let originalConsoleError: typeof console.error;
  let originalConsoleWarn: typeof console.warn;
  let originalConsoleInfo: typeof console.info;
  let originalConsoleDebug: typeof console.debug;

  beforeEach(() => {
    captured = [];
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
    originalConsoleInfo = console.info;
    originalConsoleDebug = console.debug;

    console.error = vi.fn();
    console.warn = vi.fn();
    console.info = vi.fn();
    console.debug = vi.fn();

    logger.configure((entry) => {
      captured.push(entry);
    }, 'debug');
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    console.info = originalConsoleInfo;
    console.debug = originalConsoleDebug;
  });

  describe('debug', () => {
    it('emits a debug entry with message and context', () => {
      logger.debug('test debug', 'myContext', { foo: 'bar' });
      expect(captured).toHaveLength(1);
      expect(captured[0].level).toBe('debug');
      expect(captured[0].message).toBe('test debug');
      expect(captured[0].context).toBe('myContext');
      expect(captured[0].data).toEqual({ foo: 'bar' });
    });
  });

  describe('info', () => {
    it('emits an info entry', () => {
      logger.info('test info');
      expect(captured).toHaveLength(1);
      expect(captured[0].level).toBe('info');
      expect(captured[0].message).toBe('test info');
    });
  });

  describe('warn', () => {
    it('emits a warn entry', () => {
      logger.warn('test warn', 'ctx');
      expect(captured).toHaveLength(1);
      expect(captured[0].level).toBe('warn');
      expect(captured[0].context).toBe('ctx');
    });
  });

  describe('error', () => {
    it('emits an error entry', () => {
      logger.error('test error', 'ctx', { code: 500 });
      expect(captured).toHaveLength(1);
      expect(captured[0].level).toBe('error');
      expect(captured[0].data).toEqual({ code: 500 });
    });
  });

  describe('minLevel filtering', () => {
    it('does not emit debug when minLevel is warn', () => {
      logger.configure((entry) => captured.push(entry), 'warn');
      logger.debug('should not appear');
      logger.info('should not appear');
      logger.warn('should appear');
      logger.error('should appear');
      expect(captured).toHaveLength(2);
      expect(captured[0].level).toBe('warn');
      expect(captured[1].level).toBe('error');
    });
  });

  describe('consoleSink', () => {
    it('routes to console.error for error level', () => {
      logger.configure(undefined as never, 'debug');
      logger.error('boom');
      expect(console.error).toHaveBeenCalled();
    });

    it('routes to console.warn for warn level', () => {
      logger.configure(undefined as never, 'debug');
      logger.warn('careful');
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('logError', () => {
    it('logs an Error object with stack', () => {
      const err = new Error('something failed');
      logError(err, 'myContext', { extra: 'data' });
      expect(captured).toHaveLength(1);
      expect(captured[0].level).toBe('error');
      expect(captured[0].message).toBe('something failed');
      expect(captured[0].context).toBe('myContext');
      expect(captured[0].data?.stack).toBe(err.stack);
      expect(captured[0].data?.extra).toBe('data');
    });

    it('logs a non-Error value as string', () => {
      logError('plain string error');
      expect(captured).toHaveLength(1);
      expect(captured[0].message).toBe('plain string error');
    });

    it('logs a non-Error value with extra data', () => {
      logError(42, 'ctx', { foo: 'bar' });
      expect(captured[0].message).toBe('42');
      expect(captured[0].data?.foo).toBe('bar');
    });
  });
});
