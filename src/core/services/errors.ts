/**
 * Central error handling and result types for the service layer.
 *
 * Every service method returns a `ServiceResult<T>` — a discriminated union
 * that forces callers to handle the error path explicitly. This replaces the
 * ad-hoc `{ success: boolean; data?: T; error?: string }` pattern scattered
 * across the API layer with a single, type-safe contract.
 */

export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: ErrorCode };

export type VoidServiceResult = ServiceResult<void>;

export type ErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'PERMISSION_DENIED'
  | 'CONFLICT'
  | 'PRECONDITION_FAILED'
  | 'INVALID_STATE'
  | 'EXTERNAL_ERROR'
  | 'UNKNOWN';

export class ServiceError extends Error {
  code: ErrorCode;
  constructor(message: string, code: ErrorCode = 'UNKNOWN') {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
  }
}

export function ok<T>(data: T): ServiceResult<T> {
  return { success: true, data };
}

export function fail<T = never>(error: string, code?: ErrorCode): ServiceResult<T> {
  return { success: false, error, code };
}

export function notFound(entity: string): ServiceResult<never> {
  return { success: false, error: `${entity} غير موجود`, code: 'NOT_FOUND' };
}

export function permissionDenied(action = 'هذه العملية'): ServiceResult<never> {
  return { success: false, error: `ليس لديك صلاحية ${action}`, code: 'PERMISSION_DENIED' };
}

export function invalidState(message: string): ServiceResult<never> {
  return { success: false, error: message, code: 'INVALID_STATE' };
}

export function preconditionFailed(message: string): ServiceResult<never> {
  return { success: false, error: message, code: 'PRECONDITION_FAILED' };
}

export function conflict(message: string): ServiceResult<never> {
  return { success: false, error: message, code: 'CONFLICT' };
}

/**
 * Wrap an async operation, catching errors and converting them to a
 * `ServiceResult`. Unexpected errors are logged via the observability layer.
 */
export async function wrap<T>(
  fn: () => Promise<T>,
  context?: string
): Promise<ServiceResult<T>> {
  try {
    const data = await fn();
    return ok(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof ServiceError ? err.code : 'UNKNOWN';
    if (context) {
      // Lightweight observability hook — replaced by a real logger in Phase 5.
      console.error(`[service] ${context} failed:`, message);
    }
    return { success: false, error: message, code };
  }
}

/**
 * Assert a precondition before performing a mutation. Throws a `ServiceError`
 * with `PRECONDITION_FAILED` if the condition is false.
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new ServiceError(message, 'PRECONDITION_FAILED');
  }
}