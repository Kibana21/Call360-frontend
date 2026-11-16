import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Production builds get a strict CSP meta tag. The dev server needs Vite's inline HMR preamble, so the CSP is
// applied to built assets only (the API itself always sends a strict CSP header).
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";
const cspOnBuild = (): Plugin => ({
  name: 'call360-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// The SPA and API share one origin through this proxy, so cookies stay first-party and CORS can stay
// default-deny on the backend (ADR-0003 §1). E2E runs point VITE_API_TARGET at the test backend.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react(), cspOnBuild()],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false, ws: true }, // S1-A voice stream (WebSocket)
      '/health': { target: apiTarget, changeOrigin: false },
    },
  },
  build: { sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
