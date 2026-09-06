import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
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
});
