import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from './Button';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    if (typeof console !== 'undefined') {
      console.error('ErrorBoundary caught an error:', error, errorInfo.componentStack);
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  handleHome = (): void => {
    window.location.href = '/';
  };

  override render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset);
      }
      return (
        <div
          dir="rtl"
          className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4"
        >
          <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
              <AlertTriangle size={32} className="text-rose-600 dark:text-rose-400" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 mb-2">
              حدث خطأ غير متوقع
            </h1>
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              نأسف للإزعاج. يرجى إعادة المحاولة أو العودة إلى الصفحة الرئيسية.
            </p>
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3 mb-6 text-right">
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400 break-all">
                {this.state.error.message}
              </p>
            </div>
            <div className="flex gap-2 justify-center flex-wrap">
              <Button variant="primary" onClick={this.handleReset} leftIcon={<RefreshCw size={16} />}>
                إعادة المحاولة
              </Button>
              <Button variant="secondary" onClick={this.handleHome} leftIcon={<Home size={16} />}>
                الرئيسية
              </Button>
              <Button variant="ghost" onClick={this.handleReload}>
                إعادة تحميل
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
