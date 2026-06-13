import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Test-only: collapse @ownpilot/core/* sub-path imports onto the barrel so
  // that `vi.mock('@ownpilot/core', …)` (used by ~180 test files) also covers
  // sub-path imports. Source modules import sub-paths (e.g. /services, /channels)
  // for build isolation; in tests the sub-paths are pure re-exports of the barrel,
  // so resolving them to the barrel is behaviour-identical and lets the existing
  // barrel mocks intercept capability accessors (getConfigCenter, getChannelService,
  // …). Production builds and `tsc` are unaffected — they resolve sub-paths for real.
  resolve: {
    alias: [{ find: /^@ownpilot\/core\/[\w-]+$/, replacement: '@ownpilot/core' }],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        '**/*.test.ts',
        '**/test-setup.ts',
        '**/test-helpers.ts',
        'dist/**',
        '**/types.ts',
        '**/index.ts',
        '**/*.d.ts',
        '**/vitest.config.ts',
        'scripts/**',
        '**/seed-database.ts',
        '**/plans-seed.ts',
        'src/db/seeds/**',
        'src/services/log.ts',
        'src/app.ts',
        'src/server.ts',
        'src/channels/plugins/telegram/telegram-api.ts',
        'src/middleware/audit.ts',
        // Pure re-export barrel files — no logic to cover
        'src/routes/extensions.ts',
        'src/routes/custom-tools.ts',
        'src/routes/database.ts',
        'src/routes/model-configs.ts',
        'src/routes/workspaces.ts',
      ],
    },
    typecheck: {
      enabled: true,
    },
  },
});
