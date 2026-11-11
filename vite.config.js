import { defineConfig } from 'vite';

// DEV_FIXTURES=1 serves synthetic data from .dev/ for UI work only. Production builds
// always use public/data, which the data pipeline writes.
export default defineConfig({
  base: './',
  publicDir: process.env.DEV_FIXTURES ? '.dev/public' : 'public',
  build: { target: 'es2020', chunkSizeWarningLimit: 1600 },
  server: { host: '0.0.0.0' },
});
