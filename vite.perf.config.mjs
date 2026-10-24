// Private no-HMR dev server for the perf-1650 agent (port 5167). Safe to delete.
import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5167, strictPort: true, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/progress/**', '**/refs/**', '**/blender/**', '**/*.blend', '**/*.blend1', '**/docs/**'] } },
  preview: { port: 4167, strictPort: true, host: '127.0.0.1' },
  // KCA_NOMIN=1 → unminified build in progress/tmp/perfdist_nomin (readable CPU profiles; preview it on :4168)
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, outDir: process.env.KCA_NOMIN ? 'progress/tmp/perfdist_nomin' : 'progress/tmp/perfdist', emptyOutDir: true, minify: !process.env.KCA_NOMIN },
});
