/**
 * ESM resolve hook: appends .ts/.tsx/.js for relative specifiers without
 * extensions so that Node can load the repo's TypeScript files (type
 * stripping is enabled by default on Node 24 for .ts).
 *
 * Used by repro/smoke scripts only (npm run with --import).
 */
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL) {
    try {
      const abs = fileURLToPath(new URL(specifier, context.parentURL));
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return nextResolve(pathToFileURL(abs).href, context);
      for (const ext of ['.ts', '.tsx', '.js']) {
        if (fs.existsSync(abs + ext) && fs.statSync(abs + ext).isFile()) {
          return nextResolve(pathToFileURL(abs + ext).href, context);
        }
      }
    } catch {
      /* fall through to default */
    }
  }
  return nextResolve(specifier, context);
}
