import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, LogIn, Eye, EyeOff, ShieldCheck, User, Lock } from 'lucide-react';
import { Button, Input } from '@/core/ui/components';
import { useAuthStore } from '../store';
import { authApi } from '../api';
import { useTranslation } from '@/core/i18n/useTranslation';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const login = useAuthStore((state) => state.login);
  const [credentials, setCredentials] = useState({ username: '', password: '', rememberMe: false });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAnimation, setShowAnimation] = useState(false);

  useEffect(() => {
    const remembered = localStorage.getItem('auth_remember');
    if (remembered) {
      setCredentials((prev) => ({ ...prev, username: remembered, rememberMe: true }));
    }
    // Trigger entrance animation
    const timer = setTimeout(() => setShowAnimation(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await authApi.login(credentials);

    if (result.success && result.user) {
      login(result.user, result.permissions);
      navigate('/');
    } else {
      setError(result.error || t('auth.invalidCredentials'));
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 p-4 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-gold-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary-600/5 rounded-full blur-3xl" />
        {/* Floating shapes */}
        <div className="absolute top-20 left-20 w-8 h-8 bg-primary-500/20 rounded-lg rotate-45 animate-bounce" style={{ animationDuration: '3s' }} />
        <div className="absolute bottom-32 right-24 w-6 h-6 bg-gold-500/20 rounded-full animate-bounce" style={{ animationDuration: '4s', animationDelay: '1s' }} />
        <div className="absolute top-1/3 right-16 w-10 h-10 border-2 border-primary-500/20 rounded-xl rotate-12 animate-pulse" />
      </div>

      <div className={`w-full max-w-md relative z-10 transition-all duration-700 ${showAnimation ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-primary-600/30 animate-scale-in">
            <Building2 size={40} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{t('appName')}</h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">{t('appSubtitle')}</p>
        </div>

        {/* Login Form */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-zinc-200 dark:border-zinc-800 p-6 sm:p-8 backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-6">
            <ShieldCheck size={20} className="text-primary-600" />
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{t('auth.login')}</h2>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800 rounded-lg text-danger-600 dark:text-danger-400 text-sm animate-shake">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="relative">
              <User size={18} className="absolute right-3 top-[2.6rem] text-zinc-400 pointer-events-none" />
              <Input
                label={t('auth.username')}
                value={credentials.username}
                onChange={(e) => setCredentials((prev) => ({ ...prev, username: e.target.value }))}
                required
                autoFocus
                className="pr-10"
              />
            </div>

            <div className="relative">
              <Lock size={18} className="absolute right-3 top-[2.6rem] text-zinc-400 pointer-events-none" />
              <Input
                label={t('auth.password')}
                type={showPassword ? 'text' : 'password'}
                value={credentials.password}
                onChange={(e) => setCredentials((prev) => ({ ...prev, password: e.target.value }))}
                required
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute left-3 top-[2.6rem] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={credentials.rememberMe}
                  onChange={(e) => setCredentials((prev) => ({ ...prev, rememberMe: e.target.checked }))}
                  className="w-4 h-4 rounded border-zinc-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-zinc-600 dark:text-zinc-300 group-hover:text-zinc-800 dark:group-hover:text-zinc-200 transition-colors">
                  {t('auth.rememberMe')}
                </span>
              </label>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              leftIcon={<LogIn size={18} />}
              isLoading={isLoading}
            >
              {t('auth.login')}
            </Button>
          </form>

        </div>

        <p className="text-center text-xs text-zinc-400 dark:text-zinc-500 mt-6">
          © {new Date().getFullYear()} maghzaccount-pro — v0.3.7
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
