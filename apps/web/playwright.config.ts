import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./browser",
  globalSetup: "./browser/global-setup.ts",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  workers: 4,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "transfer-recovery",
      testMatch: ["transfer-recovery.spec.ts", "upstream.spec.ts"],
    },
    {
      name: "campaign",
      testIgnore: ["transfer-recovery.spec.ts", "upstream.spec.ts"],
    },
  ],
});
