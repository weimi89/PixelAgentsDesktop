#!/usr/bin/env node
// ── Build script for pixel-agents-sidecar ──
//
// Usage:
//   node scripts/build-sidecar.mjs           # build only
//   node scripts/build-sidecar.mjs --watch   # watch mode

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const sidecarDir = resolve(projectRoot, 'sidecar');

const isWatch = process.argv.includes('--watch');

// ── Step 1: Ensure dependencies are installed ──
if (!existsSync(resolve(sidecarDir, 'node_modules'))) {
  console.log('[build-sidecar] Installing sidecar dependencies...');
  execSync('npm install', { cwd: sidecarDir, stdio: 'inherit' });
}

// ── Step 2: Run esbuild ──
const buildCmd = isWatch ? 'npm run dev' : 'npm run build';
console.log(`[build-sidecar] Running: ${buildCmd}`);
execSync(buildCmd, { cwd: sidecarDir, stdio: 'inherit' });

if (!isWatch) {
  console.log('[build-sidecar] Done. Output: sidecar/dist/sidecar.mjs');
  console.log('[build-sidecar] Test with:');
  console.log('  echo \'{"id":1,"method":"getStatus"}\' | node sidecar/dist/sidecar.mjs');
}
