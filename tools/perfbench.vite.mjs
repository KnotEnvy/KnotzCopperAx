// Build config for tools/perfbench.mjs (perf-1650): production bundle WITHOUT copying public/ (513 MB), written to
// public/_bench/<name> (PB_OUT, absolute) with base './' so it runs from http://127.0.0.1:5190/_bench/<name>/index.html.
// Public assets resolve either absolutely (/assets/...) or via BASE_URL ('./assets/...' → /_bench/<name>/assets/...,
// which perfbench's browser route forwards to the shared server's /assets/...).
import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  publicDir: false,
  logLevel: 'warn',
  build: { target: 'es2022', chunkSizeWarningLimit: 8000, outDir: process.env.PB_OUT || 'public/_bench/cand', emptyOutDir: true, minify: process.env.PB_MINIFY !== '0', reportCompressedSize: false },
});
