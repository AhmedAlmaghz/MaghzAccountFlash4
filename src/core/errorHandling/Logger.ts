/**
 * Central Logger
 * 
 * Provides unified logging across the application:
 * - Structured logging with levels
 * - Contextual information
 * - Performance tracking
 * - Debug/Release mode handling
 */

export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4,
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

/** Reverse lookup: numeric level → string name (replaces enum reverse mapping). */
export const LogLevelName: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.FATAL]: 'FATAL',
};

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  category?: string;
  duration?: number;
  stack?: string;
}

export class Logger {
  private static instance: Logger;
  private currentLevel: LogLevel = LogLevel.INFO;
  private logs: LogEntry[] = [];
  private readonly MAX_LOGS = 1000;
  private performanceMarks: Map<string, number> = new Map();

  private constructor() {
    // Set log level based on environment
    if (import.meta.env.DEV) {
      this.currentLevel = LogLevel.DEBUG;
    } else {
      this.currentLevel = LogLevel.INFO;
    }
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Set current log level
   */
  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log error message
   */
  error(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log(LogLevel.ERROR, message, context, error?.stack);
  }

  /**
   * Log fatal message
   */
  fatal(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log(LogLevel.FATAL, message, context, error?.stack);
  }

  /**
   * Core logging method
   */
  private log(level: LogLevel, message: string, context?: Record<string, unknown>, stack?: string): void {
    if (level < this.currentLevel) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
      stack,
    };

    // Add to in-memory logs
    this.logs.push(entry);
    
    // Keep only last MAX_LOGS
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }

    // Console output
    this.outputToConsole(entry);
  }

  /**
   * Output log entry to console
   */
  private outputToConsole(entry: LogEntry): void {
    const levelName = LogLevelName[entry.level];
    const timestamp = new Date(entry.timestamp).toLocaleTimeString('ar-SA');
    const prefix = `[${timestamp}] [${levelName}]`;

    const consoleMethod = this.getConsoleMethod(entry.level);
    
    if (entry.context) {
      consoleMethod(prefix, entry.message, entry.context);
    } else {
      consoleMethod(prefix, entry.message);
    }

    if (entry.stack) {
      console.error(entry.stack);
    }
  }

  /**
   * Get console method for log level
   */
  private getConsoleMethod(level: LogLevel): (...args: unknown[]) => void {
    switch (level) {
      case LogLevel.DEBUG:
        return console.debug;
      case LogLevel.INFO:
        return console.info;
      case LogLevel.WARN:
        return console.warn;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        return console.error;
      default:
        return console.log;
    }
  }

  /**
   * Start performance measurement
   */
  startPerformanceMark(name: string): void {
    this.performanceMarks.set(name, performance.now());
  }

  /**
   * End performance measurement and log
   */
  endPerformanceMark(name: string, category?: string): number {
    const startTime = this.performanceMarks.get(name);
    if (!startTime) {
      this.warn(`Performance mark '${name}' not found`);
      return 0;
    }

    const duration = performance.now() - startTime;
    this.performanceMarks.delete(name);

    this.log(LogLevel.DEBUG, `Performance: ${name}`, { 
      duration: `${duration.toFixed(2)}ms`,
      category 
    });

    return duration;
  }

  /**
   * Log performance measurement
   */
  logPerformance(name: string, duration: number, category?: string): void {
    this.log(LogLevel.DEBUG, `Performance: ${name}`, {
      duration: `${duration.toFixed(2)}ms`,
      category,
    });
  }

  /**
   * Get log entries
   */
  getLogs(filter?: {
    level?: LogLevel;
    category?: string;
    since?: Date;
  }): LogEntry[] {
    let filtered = [...this.logs];

    if (filter?.level !== undefined) {
      filtered = filtered.filter(log => log.level === filter.level);
    }

    if (filter?.category) {
      filtered = filtered.filter(log => log.context?.category === filter.category);
    }

    if (filter?.since) {
      filtered = filtered.filter(log => new Date(log.timestamp) >= filter.since!);
    }

    return filtered;
  }

  /**
   * Clear logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Export logs as JSON
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Create a category-specific logger
   */
  createCategoryLogger(category: string): {
    debug: (message: string, context?: Record<string, unknown>) => void;
    info: (message: string, context?: Record<string, unknown>) => void;
    warn: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>, error?: Error) => void;
    fatal: (message: string, context?: Record<string, unknown>, error?: Error) => void;
  } {
    return {
      debug: (message: string, context?: Record<string, unknown>) => {
        this.debug(message, { ...context, category });
      },
      info: (message: string, context?: Record<string, unknown>) => {
        this.info(message, { ...context, category });
      },
      warn: (message: string, context?: Record<string, unknown>) => {
        this.warn(message, { ...context, category });
      },
      error: (message: string, context?: Record<string, unknown>, error?: Error) => {
        this.error(message, { ...context, category }, error);
      },
      fatal: (message: string, context?: Record<string, unknown>, error?: Error) => {
        this.fatal(message, { ...context, category }, error);
      },
    };
  }
}

// Export singleton instance
export const logger = Logger.getInstance();

// Create category-specific loggers for common modules
export const authLogger = logger.createCategoryLogger('auth');
export const dbLogger = logger.createCategoryLogger('database');
export const apiLogger = logger.createCategoryLogger('api');
export const serviceLogger = logger.createCategoryLogger('service');
export const uiLogger = logger.createCategoryLogger('ui');
