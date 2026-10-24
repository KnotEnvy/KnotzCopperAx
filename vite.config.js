import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5190,
    strictPort: true,
    host: '127.0.0.1',
    // Many agents edit files concurrently; keep the overlay so errors are visible in captures.
    hmr: { overlay: true },
    watch: { ignored: ['**/progress/**', '**/refs/**', '**/blender/**', '**/public/_bench/**', '**/*.blend', '**/*.blend1'] },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
