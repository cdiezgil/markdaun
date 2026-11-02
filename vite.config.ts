import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'chrome105',
  },
  test: {
    globals: true,
    exclude: ['mobile/**', 'node_modules/**', 'dist/**', 'e2e/**'],
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        lines: 80,
      },
    },
  },
});
