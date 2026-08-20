import { defineConfig } from '@playwright/test';

// Three projects, split by testMatch so each spec runs on the surface it is
// about — the desktop project is the shipped suite, exactly as it always ran.
export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'tests/artifacts/pw',
  timeout: 60_000,
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 720 } },
      testIgnore: /(touch|portrait|smallview)\.spec\.js/,
    },
    {
      // iPhone-ish, held the way the game is meant to be played: landscape,
      // dpr 3, real touch. Drives the verb through the touchscreen, not tapes.
      name: 'mobile',
      testMatch: /(touch|portrait)\.spec\.js/,
      use: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3,
             hasTouch: true, isMobile: true },
    },
    {
      // A desktop window smaller than one game pixel per device pixel — the
      // sub-640 fractional-fit branch (engine/fit.js).
      name: 'small-desktop',
      testMatch: /smallview\.spec\.js/,
      use: { viewport: { width: 500, height: 400 } },
    },
  ],
  webServer: {
    command: 'node tools/serve.mjs 8123',
    port: 8123,
    reuseExistingServer: true,
  },
});
