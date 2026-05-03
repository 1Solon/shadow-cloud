import { spawn } from "node:child_process";
import { loadRootEnv, resolveWebPort } from "../../../scripts/dev-env.mjs";

await loadRootEnv();

const defaultApiBaseUrl = "http://localhost:3001";
const apiBaseUrl = process.env.SHADOW_CLOUD_API_URL ?? defaultApiBaseUrl;
const apiHealthUrl = new URL("/v1", apiBaseUrl).toString();
const webPort = resolveWebPort();
const apiStartupTimeoutMs = Number.parseInt(
  process.env.SHADOW_CLOUD_API_STARTUP_TIMEOUT_MS ?? "60000",
  10,
);
const apiStartupPollIntervalMs = 500;
const shouldWaitForApi = process.env.SHADOW_CLOUD_SKIP_API_WAIT !== "1";
const pnpmCommand = `pnpm exec next dev --port ${webPort}`;
const duplicateServerMessage = "Another next dev server is already running.";

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
          console.log(`[shadow-cloud:web] API ready at ${apiHealthUrl}.`);
        }

        return;
      }
    } catch {
      // Keep polling until the API becomes reachable or the timeout expires.
    }

    if (!hasLoggedWaitMessage) {
      hasLoggedWaitMessage = true;
      console.log(
        `[shadow-cloud:web] Waiting for API readiness at ${apiHealthUrl}...`,
      );
    }

    await delay(apiStartupPollIntervalMs);
  }

  console.error(
    `[shadow-cloud:web] Timed out waiting for API readiness at ${apiHealthUrl}. Set SHADOW_CLOUD_SKIP_API_WAIT=1 to bypass this check.`,
  );
  process.exit(1);
}

await waitForApiReadiness();

const child = spawn(pnpmCommand, {
  cwd: process.cwd(),
  env: process.env,
  shell: true,
  stdio: ["inherit", "pipe", "pipe"],
});

let combinedOutput = "";
let keepingAliveForExistingServer = false;
let keepAliveInterval;

function mirror(stream) {
  stream.on("data", (chunk) => {
    const text = chunk.toString();
    combinedOutput += text;
    process.stdout.write(text);
  });
}

mirror(child.stdout);

child.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  combinedOutput += text;
  process.stderr.write(text);
});

function stopKeepAlive(exitCode = 0) {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = undefined;
  }

  process.exit(exitCode);
}

function beginKeepAlive() {
  if (keepingAliveForExistingServer) {
    return;
  }

  keepingAliveForExistingServer = true;
  console.log("[shadow-cloud:web] Reusing existing next dev server.");
  keepAliveInterval = setInterval(() => undefined, 60_000);
}

child.on("exit", (code, signal) => {
  if ((code ?? 0) !== 0 && combinedOutput.includes(duplicateServerMessage)) {
    beginKeepAlive();
    return;
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

for (const eventName of ["SIGINT", "SIGTERM"]) {
  process.on(eventName, () => {
    if (keepingAliveForExistingServer) {
      stopKeepAlive(0);
      return;
    }

    child.kill(eventName);
  });
}
