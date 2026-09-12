import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/modules/auth/store';

/**
 * Session heartbeat — records user activity and auto-logouts after the
 * inactivity window. Shared by AppLayout and the full-screen POS terminal
 * (which bypasses AppLayout but still must expire on idle).
 *
 * Same listeners as AppLayout: mousedown / keydown / scroll / touchstart,
 * all passive; a 60s interval checks `checkSession()` and navigates to
 * /login when the session has expired.
 */
export function useSessionHeartbeat(enabled: boolean): void {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const recordActivity = useAuthStore((s) => s.recordActivity);
  const checkSession = useAuthStore((s) => s.checkSession);

  const handleActivity = useCallback(() => {
    if (isAuthenticated) {
      recordActivity();
    }
  }, [isAuthenticated, recordActivity]);

  useEffect(() => {
    if (!enabled || !isAuthenticated) return;

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, handleActivity, { passive: true }));

    const interval = setInterval(() => {
      if (!checkSession()) {
        navigate('/login');
      }
    }, 60000);

    return () => {
      events.forEach((event) => window.removeEventListener(event, handleActivity));
      clearInterval(interval);
    };
  }, [enabled, isAuthenticated, handleActivity, checkSession, navigate]);
}
