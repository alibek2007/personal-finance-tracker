import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in dev: browser talks to /api, Vite forwards to the API (cookies just work).
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000',
        changeOrigin: false,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks cache across releases: app code changes far more often than libraries.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/recharts|d3-|victory-vendor|decimal\.js-light|internmap/.test(id)) return 'charts';
          if (/react-router/.test(id)) return 'router';
          if (/@radix-ui|cmdk|aria-hidden|react-remove-scroll|@floating-ui/.test(id))
            return 'ui-kit';
          if (/@tanstack/.test(id)) return 'query';
          if (/date-fns/.test(id)) return 'dates';
          if (/zod|react-hook-form|@hookform/.test(id)) return 'forms';
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // The lazy dashboard chunk imports the charting library; compiling it cold can take several seconds.
    testTimeout: 20_000,
  },
});
