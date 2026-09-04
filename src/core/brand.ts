/**
 * Brand single source of truth — app name, icon contract & dynamic version.
 *
 * - The visible name/subtitle ALWAYS come from i18n (`appName`/`appSubtitle`)
 *   so Arabic/English stay in sync.
 * - The icon contract is `Building2` (lucide-react), rendered by `AppBrand`
 *   with the brand emerald→gold gradient.
 * - The version is injected at build time from package.json via
 *   `__APP_VERSION__` (see vite.config.ts). Never hard-code a version
 *   string in UI code — it rots on the next release.
 */

declare const __APP_VERSION__: string | undefined;

function resolveVersion(): string {
  try {
    if (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) {
      return __APP_VERSION__;
    }
  } catch {
    // bundler without the define (e.g. unit tests) — fall through
  }
  return '0.0.0-dev';
}

/** Raw semver from package.json at build time (e.g. "0.12.3"). */
export const APP_VERSION: string = resolveVersion();

/** Display label, always prefixed (e.g. "v0.12.3"). Never translated. */
export const APP_VERSION_LABEL: string = `v${APP_VERSION}`;
