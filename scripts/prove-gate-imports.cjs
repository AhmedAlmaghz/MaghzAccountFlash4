// The vitest gates import shared modules from scripts/ — the app tsconfig
// excludes src/test, so `tsc -b` never checks those imports. Bundle them
// with esbuild (same relative-path semantics as vite/vitest) to prove the
// specifiers resolve.
const { build } = require('esbuild');

const ENTRIES = [
  'src/test/encodingGate.test.ts',
  'src/test/e2eShimParity.test.ts',
];

(async () => {
  for (const entry of ENTRIES) {
    try {
      const result = await build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'esm',
        target: 'node20',
        external: ['vitest'],
        logLevel: 'error',
      });
      const text = result.outputFiles[0].text;
      const inlined = /encodingSignatures|shimChecks/.test(text);
      console.log(
        `${inlined ? 'OK  ' : 'FAIL'} ${entry} — bundled ${text.length} bytes` +
          (inlined ? '' : ' (the shared module was NOT inlined)'),
      );
      if (!inlined) process.exit(1);
    } catch (err) {
      console.log(`FAIL ${entry}: ${String(err.message || err).slice(0, 400)}`);
      process.exit(1);
    }
  }
})();
