/**
 * Central Error Handler
 *
 * Provides unified error handling across the application:
 * - Error classification and categorization
 * - User-friendly error messages
 * - Error logging and tracking
 * - Error recovery suggestions
 */

// ─── Enums (as const objects for erasableSyntaxOnly compatibility) ──────────

export const ErrorCategory = {
  VALIDATION: 'validation',
  PERMISSION: 'permission',
  DATABASE: 'database',
  NETWORK: 'network',
  BUSINESS_LOGIC: 'business_logic',
  SYSTEM: 'system',
  UNKNOWN: 'unknown',
} as const;
export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

export const ErrorSeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;
export type ErrorSeverity = (typeof ErrorSeverity)[keyof typeof ErrorSeverity];

// ─── AppError as a class so `instanceof` works at runtime ──────────────────

export class AppErrorClass {
  code: string;
  message: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  userMessage: string;
  technicalDetails?: string;
  suggestions?: string[];
  context?: Record<string, unknown>;
  timestamp: string;
  stack?: string;

  constructor(data: {
    code: string;
    message: string;
    category: ErrorCategory;
    severity: ErrorSeverity;
    userMessage: string;
    technicalDetails?: string;
    suggestions?: string[];
    context?: Record<string, unknown>;
    timestamp: string;
    stack?: string;
  }) {
    this.code = data.code;
    this.message = data.message;
    this.category = data.category;
    this.severity = data.severity;
    this.userMessage = data.userMessage;
    this.technicalDetails = data.technicalDetails;
    this.suggestions = data.suggestions;
    this.context = data.context;
    this.timestamp = data.timestamp;
    this.stack = data.stack;
  }

  /** Duck-typed check for plain objects that look like AppError. */
  static isAppError(obj: unknown): obj is AppError {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'code' in obj &&
      'category' in obj &&
      'severity' in obj &&
      'userMessage' in obj &&
      'timestamp' in obj
    );
  }
}

/**
 * Shape of an AppError — used as a type throughout the codebase.
 * At runtime, `instanceof AppErrorClass` (or the `isAppError` guard) is used.
 */
export interface AppError {
  code: string;
  message: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  userMessage: string;
  technicalDetails?: string;
  suggestions?: string[];
  context?: Record<string, unknown>;
  timestamp: string;
  stack?: string;
}

/** Convenience alias — the class is the canonical runtime representation. */
export const AppError = AppErrorClass;

export class ErrorHandler {
  private static instance: ErrorHandler;
  private errorCallbacks: Array<(error: AppError) => void> = [];

  private constructor() {
    // Setup global error handlers
    if (typeof window !== 'undefined') {
      window.addEventListener('error', this.handleGlobalError.bind(this));
      window.addEventListener('unhandledrejection', this.handleUnhandledRejection.bind(this));
    }
  }

  static getInstance(): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler();
    }
    return ErrorHandler.instance;
  }

  /**
   * Register error callback
   */
  onError(callback: (error: AppError) => void): () => void {
    this.errorCallbacks.push(callback);
    return () => {
      const index = this.errorCallbacks.indexOf(callback);
      if (index > -1) {
        this.errorCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Handle an error
   */
  handle(error: unknown, context?: Record<string, unknown>): AppError {
    const appError = this.classifyError(error, context);

    // Log the error
    this.logError(appError);

    // Notify callbacks
    this.errorCallbacks.forEach(callback => {
      try {
        callback(appError);
      } catch (callbackError) {
        console.error('Error in error callback:', callbackError);
      }
    });

    return appError;
  }

  /**
   * Classify an error into AppError format
   */
  private classifyError(error: unknown, context?: Record<string, unknown>): AppError {
    if (AppErrorClass.isAppError(error)) {
      return error;
    }

    if (error instanceof Error) {
      return this.createAppErrorFromError(error, context);
    }

    if (typeof error === 'string') {
      return this.createAppErrorFromString(error, context);
    }

    return this.createUnknownError(error, context);
  }

  /**
   * Create AppError from Error object
   */
  private createAppErrorFromError(error: Error, context?: Record<string, unknown>): AppError {
    const timestamp = new Date().toISOString();
    const message = error.message.toLowerCase();
    let category: ErrorCategory = ErrorCategory.UNKNOWN;
    let severity: ErrorSeverity = ErrorSeverity.MEDIUM;
    let userMessage = error.message;
    let suggestions: string[] | undefined;

    // Classify error based on message
    if (message.includes('permission') || message.includes('authorized') || message.includes('access')) {
      category = ErrorCategory.PERMISSION;
      severity = ErrorSeverity.HIGH;
      userMessage = 'ليس لديك الصلاحية الكافية للقيام بهذه العملية';
      suggestions = ['تواصل مع المسؤول للحصول على الصلاحيات المطلوبة', 'تحقق من صلاحيات حسابك'];
    } else if (message.includes('validation') || message.includes('invalid') || message.includes('required')) {
      category = ErrorCategory.VALIDATION;
      severity = ErrorSeverity.LOW;
      userMessage = 'البيانات المدخلة غير صحيحة';
      suggestions = ['تحقق من البيانات المدخلة', 'أكمل جميع الحقول المطلوبة'];
    } else if (message.includes('database') || message.includes('sql') || message.includes('query')) {
      category = ErrorCategory.DATABASE;
      severity = ErrorSeverity.HIGH;
      userMessage = 'حدث خطأ في قاعدة البيانات';
      suggestions = ['حاول مرة أخرى', 'إذا استمرت المشكلة، تواصل مع الدعم الفني'];
    } else if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
      category = ErrorCategory.NETWORK;
      severity = ErrorSeverity.MEDIUM;
      userMessage = 'حدث خطأ في الاتصال';
      suggestions = ['تحقق من اتصال الإنترنت', 'حاول مرة أخرى'];
    } else if (message.includes('posted') || message.includes('immutable')) {
      category = ErrorCategory.BUSINESS_LOGIC;
      severity = ErrorSeverity.MEDIUM;
      userMessage = 'لا يمكن تعديل هذا السجل لأنه مرحل';
      suggestions = ['استخدم وظيفة الإلغاء/الاسترجاع لتعديل السجلات المرحلة'];
    }

    return {
      code: this.generateErrorCode(category),
      message: error.message,
      category,
      severity,
      userMessage,
      technicalDetails: error.stack,
      suggestions,
      context,
      timestamp,
      stack: error.stack,
    };
  }

  /**
   * Create AppError from string
   */
  private createAppErrorFromString(message: string, context?: Record<string, unknown>): AppError {
    const timestamp = new Date().toISOString();
    const lowerMessage = message.toLowerCase();
    let category: ErrorCategory = ErrorCategory.UNKNOWN;
    let severity: ErrorSeverity = ErrorSeverity.MEDIUM;
    let userMessage = message;

    if (lowerMessage.includes('permission')) {
      category = ErrorCategory.PERMISSION;
      severity = ErrorSeverity.HIGH;
      userMessage = 'ليس لديك الصلاحية الكافية';
    } else if (lowerMessage.includes('validation')) {
      category = ErrorCategory.VALIDATION;
      severity = ErrorSeverity.LOW;
      userMessage = 'البيانات غير صحيحة';
    }

    return {
      code: this.generateErrorCode(category),
      message,
      category,
      severity,
      userMessage,
      context,
      timestamp,
    };
  }

  /**
   * Create unknown error
   */
  private createUnknownError(error: unknown, context?: Record<string, unknown>): AppError {
    const timestamp = new Date().toISOString();
    return {
      code: this.generateErrorCode(ErrorCategory.UNKNOWN),
      message: String(error),
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.MEDIUM,
      userMessage: 'حدث خطأ غير معروف',
      technicalDetails: JSON.stringify(error),
      context,
      timestamp,
    };
  }

  /**
   * Generate error code
   */
  private generateErrorCode(category: ErrorCategory): string {
    const prefix = {
      [ErrorCategory.VALIDATION]: 'VAL',
      [ErrorCategory.PERMISSION]: 'PERM',
      [ErrorCategory.DATABASE]: 'DB',
      [ErrorCategory.NETWORK]: 'NET',
      [ErrorCategory.BUSINESS_LOGIC]: 'BIZ',
      [ErrorCategory.SYSTEM]: 'SYS',
      [ErrorCategory.UNKNOWN]: 'UNK',
    }[category];

    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();

    return `${prefix}-${timestamp}-${random}`;
  }

  /**
   * Log error
   */
  private logError(error: AppError): void {
    const logLevel = this.getLogLevel(error.severity);
    const logMessage = `[${error.code}] ${error.userMessage}`;

    // Console logging with appropriate level
    switch (logLevel) {
      case 'error':
        console.error(logMessage, error);
        break;
      case 'warn':
        console.warn(logMessage, error);
        break;
      case 'info':
        console.info(logMessage, error);
        break;
      default:
        console.log(logMessage, error);
    }

    // Store in localStorage for error tracking (limited to last 50 errors)
    try {
      const errorHistory = this.getErrorHistory();
      errorHistory.push(error);

      // Keep only last 50 errors
      if (errorHistory.length > 50) {
        errorHistory.shift();
      }

      localStorage.setItem('error_history', JSON.stringify(errorHistory));
    } catch (storageError) {
      console.warn('Failed to store error in localStorage:', storageError);
    }
  }

  /**
   * Get log level from severity
   */
  private getLogLevel(severity: ErrorSeverity): 'error' | 'warn' | 'info' | 'log' {
    switch (severity) {
      case ErrorSeverity.CRITICAL:
      case ErrorSeverity.HIGH:
        return 'error';
      case ErrorSeverity.MEDIUM:
        return 'warn';
      case ErrorSeverity.LOW:
        return 'info';
      default:
        return 'log';
    }
  }

  /**
   * Get error history from localStorage
   */
  getErrorHistory(): AppError[] {
    try {
      const history = localStorage.getItem('error_history');
      return history ? JSON.parse(history) : [];
    } catch {
      return [];
    }
  }

  /**
   * Clear error history
   */
  clearErrorHistory(): void {
    localStorage.removeItem('error_history');
  }

  /**
   * Handle global error
   */
  private handleGlobalError(event: ErrorEvent): void {
    this.handle(event.error, {
      type: 'global_error',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  }

  /**
   * Handle unhandled promise rejection
   */
  private handleUnhandledRejection(event: PromiseRejectionEvent): void {
    this.handle(event.reason, {
      type: 'unhandled_rejection',
      promise: true,
    });
  }

  /**
   * Create a user-friendly error response
   */
  createUserResponse(error: AppError): {
    success: false;
    error: string;
    code?: string;
    suggestions?: string[];
  } {
    return {
      success: false,
      error: error.userMessage,
      code: error.code,
      suggestions: error.suggestions,
    };
  }
}

// Export singleton instance
export const errorHandler = ErrorHandler.getInstance();

// Helper function to handle errors in try-catch blocks
export function tryCatch<T>(
  operation: () => T,
  context?: Record<string, unknown>
): T | never {
  try {
    return operation();
  } catch (error) {
    throw errorHandler.handle(error, context);
  }
}

// Helper function for async operations
export async function tryCatchAsync<T>(
  operation: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw errorHandler.handle(error, context);
  }
}