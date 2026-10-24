import { defineConfig } from 'vite';
export default defineConfig({
  root: '.',
  cacheDir: 'C:/Users/jwsny/AppData/Local/Temp/claude/D--JavaScript-Games-KnotzCopperAx/c07f7739-7708-4a40-a0f6-27386bfb21df/scratchpad/vitecache',
  server: { port: 5147, strictPort: true, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/progress/**', '**/refs/**', '**/blender/**', '**/*.blend', '**/*.blend1'] } },
  build: { target: 'es2022' },
});
