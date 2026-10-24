import { defineConfig } from 'vite';
// PRIVATE no-HMR dev server for the stage2-env agent (port 5174). Delete when done.
export default defineConfig({
  server: { port: 5174, strictPort: true, host: '127.0.0.1', hmr: false,
    watch: { ignored: ['**/progress/**', '**/refs/**', '**/blender/**', '**/*.blend', '**/*.blend1'] } },
});
