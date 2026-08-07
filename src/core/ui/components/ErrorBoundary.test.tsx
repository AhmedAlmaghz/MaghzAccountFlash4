import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test bomb');
  }
  return <div>Safe content</div>;
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Safe content')).toBeInTheDocument();
  });

  it('catches errors and shows fallback UI', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('حدث خطأ غير متوقع')).toBeInTheDocument();
    expect(screen.getByText('Test bomb')).toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={(err, reset) => (
        <div>
          <span>Custom: {err.message}</span>
          <button onClick={reset}>Reset</button>
        </div>
      )}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Custom: Test bomb')).toBeInTheDocument();
  });

  it('recovers when child stops throwing after reset', () => {
    let shouldThrow = true;
    const { rerender } = render(
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );
    expect(screen.getByText('حدث خطأ غير متوقع')).toBeInTheDocument();
    shouldThrow = false;
    const button = screen.getByText('إعادة المحاولة');
    button.click();
    rerender(
      <ErrorBoundary>
        <Bomb shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Safe content')).toBeInTheDocument();
  });
});
