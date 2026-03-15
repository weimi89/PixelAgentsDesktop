import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/sidecar.mjs',
  sourcemap: true,
  banner: {
    // Provide require() and __dirname in ESM context for dependencies that need it
    js: [
      'import { createRequire } from "module";',
      'const require = createRequire(import.meta.url);',
    ].join('\n'),
  },
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.error('[sidecar] watching for changes...');
} else {
  await esbuild.build(buildOptions);
  console.error('[sidecar] build complete → dist/sidecar.mjs');
}
