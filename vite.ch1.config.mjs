// Private no-HMR dev server for the chapter1-integration agent (port 5151). Safe to delete.
import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5151, strictPort: true, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/progress/**', '**/refs/**', '**/blender/**', '**/*.blend', '**/*.blend1', '**/docs/**'] } },
  build: { target: 'es2022' },
});
