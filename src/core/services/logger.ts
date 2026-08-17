/**
 * Centralized logging / observability layer.
 *
 * Replaces ad-hoc `console.error` / `console.warn` calls scattered across the
 * codebase with a single structured logger. In production the logger can be
 * swapped for a remote telemetry sink (Sentry, Logtail, …) without touching
 * call sites.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

type LogSink = (entry: LogEntry) => void;

const consoleSink: LogSink = (entry) => {
  const prefix = entry.context ? `[${entry.context}]` : '[app]';
  const payload = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
  const line = `${prefix} ${entry.message}${payload}`;
  switch (entry.level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    case 'info':
      console.info(line);
      break;
    default:
      console.debug(line);
      break;
  }
};

class Logger {
  private sink: LogSink;
  private minLevel: LogLevel;

  constructor(sink: LogSink = consoleSink, minLevel: LogLevel = 'info') {
    this.sink = sink;
    this.minLevel = minLevel;
  }

  configure(sink?: LogSink, minLevel?: LogLevel): void {
    this.sink = sink ?? consoleSink;
    if (minLevel) this.minLevel = minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    return order[level] >= order[this.minLevel];
  }

  private emit(level: LogLevel, message: string, context?: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;
    this.sink({ level, message, context, data, timestamp: new Date().toISOString() });
  }

  debug(message: string, context?: string, data?: Record<string, unknown>): void {
    this.emit('debug', message, context, data);
  }

  info(message: string, context?: string, data?: Record<string, unknown>): void {
    this.emit('info', message, context, data);
  }

  warn(message: string, context?: string, data?: Record<string, unknown>): void {
    this.emit('warn', message, context, data);
  }

  error(message: string, context?: string, data?: Record<string, unknown>): void {
    this.emit('error', message, context, data);
  }
}

export const logger = new Logger();

export function logError(error: unknown, context?: string, extra?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  const data: Record<string, unknown> = { ...(extra || {}) };
  if (error instanceof Error && error.stack) {
    data.stack = error.stack;
  }
  logger.error(message, context, data);
}