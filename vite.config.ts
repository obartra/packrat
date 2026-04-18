/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { execSync } from 'child_process';

const commitCount = execSync('git rev-list --count HEAD').toString().trim();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(commitCount),
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/__tests__/**/*.test.ts'],
    globals: false,
  },
});
