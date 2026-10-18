import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/emu/**/*.test.ts', 'test/rules/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    env: { DN_EMULATOR: '1' },
    setupFiles: ['test/emu/setup.ts'],
  },
});
