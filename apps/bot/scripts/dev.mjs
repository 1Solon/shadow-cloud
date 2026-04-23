import { spawn } from "node:child_process";

const defaultApiBaseUrl = "http://localhost:3001";
const apiBaseUrl = process.env.SHADOW_CLOUD_API_URL ?? defaultApiBaseUrl;
const apiHealthUrl = new URL("/v1", apiBaseUrl).toString();
const apiStartupTimeoutMs = Number.parseInt(
  process.env.SHADOW_CLOUD_API_STARTUP_TIMEOUT_MS ?? "60000",
  10,
);
const apiStartupPollIntervalMs = 500;
const shouldWaitForApi = process.env.SHADOW_CLOUD_SKIP_API_WAIT !== "1";
const pnpmCommand =
  process.platform === "win32"
    ? "pnpm exec tsx watch src/index.ts"
    : "pnpm exec tsx watch src/index.ts";

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function waitForApiReadiness() {
  if (!shouldWaitForApi) {
    return;
  }

  const startedAt = Date.now();
  let hasLoggedWaitMessage = false;

  while (Date.now() - startedAt < apiStartupTimeoutMs) {
    try {
      const response = await fetch(apiHealthUrl, { cache: "no-store" });

      if (response.ok) {
        if (hasLoggedWaitMessage) {
          console.log(`[shadow-cloud:bot] API ready at ${apiHealthUrl}.`);
        }

        return;
      }
    } catch {
      // Keep polling until the API becomes reachable or the timeout expires.
    }

    if (!hasLoggedWaitMessage) {
      hasLoggedWaitMessage = true;
      console.log(
        `[shadow-cloud:bot] Waiting for API readiness at ${apiHealthUrl}...`,
      );
    }

    await delay(apiStartupPollIntervalMs);
  }

  console.error(
    `[shadow-cloud:bot] Timed out waiting for API readiness at ${apiHealthUrl}. Set SHADOW_CLOUD_SKIP_API_WAIT=1 to bypass this check.`,
  );
  process.exit(1);
}

await waitForApiReadiness();

const child = spawn(pnpmCommand, {
  cwd: process.cwd(),
  env: process.env,
  shell: true,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

for (const eventName of ["SIGINT", "SIGTERM"]) {
  process.on(eventName, () => {
    child.kill(eventName);
  });
}