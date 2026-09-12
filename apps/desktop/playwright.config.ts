import { defineConfig, devices } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

export default defineConfig({
  testDir: "./browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 45_000,
  expect: { timeout: 7_500 },
  reporter: "list",
  outputDir:
    process.env.COMPANION_BROWSER_OUTPUT ??
    path.join(tmpdir(), "shadow-cloud-companion-browser"),
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:1425",
    viewport: { width: 1074, height: 800 },
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.COMPANION_BROWSER_EXECUTABLE,
    },
  },
  webServer: {
    command: "pnpm vite --host 127.0.0.1 --port 1425",
    url: "http://127.0.0.1:1425",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
