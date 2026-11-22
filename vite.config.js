import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    // The Arena preview proxy terminates TLS and rewrites the Host header.
    allowedHosts: true,
    proxy: {
      // Vercel-Python local parity: `python3 api/dev_server.py` serves the
      // exact same helio_ephemeris handler on :8787 so `npm run dev` can
      // exercise the *online* Python path before deploying.
      '/api/helio_ephemeris': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        ws: false
      }
    }
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600
  }
});
