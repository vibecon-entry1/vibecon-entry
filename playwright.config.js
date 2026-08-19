import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'tests/artifacts/pw',
  timeout: 60_000,
  use: { viewport: { width: 1280, height: 720 } },
  webServer: {
    command: 'node tools/serve.mjs 8123',
    port: 8123,
    reuseExistingServer: true,
  },
});
