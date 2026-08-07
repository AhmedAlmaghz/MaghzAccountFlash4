/**
 * Navigation bridge — lets the non-React chat engine trigger route changes.
 * A React component registers `useNavigate()` here on mount; tools then call
 * `navigateTo()` safely from anywhere.
 */

export type NavigatorFn = (path: string) => void;

let navigatorFn: NavigatorFn | null = null;

export function registerNavigator(fn: NavigatorFn): void {
  navigatorFn = fn;
}

export function unregisterNavigator(): void {
  navigatorFn = null;
}

/** Returns true when a navigator is registered and the navigation fired. */
export function navigateTo(path: string): boolean {
  if (!navigatorFn) return false;
  navigatorFn(path);
  return true;
}
