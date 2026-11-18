import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Rapier WASM init can be slow on first load; determinism tests are cheap.
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
