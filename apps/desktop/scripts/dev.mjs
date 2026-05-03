import { spawn } from "node:child_process";
import { loadRootEnv, resolveWebUrl } from "../../../scripts/dev-env.mjs";

await loadRootEnv();

const apiUrl = process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";
const webUrl = resolveWebUrl();

async function waitFor(url, label) {
  const deadline = Date.now() + 90_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);

      if (response.ok || response.status < 500) {
        return;
      }
    } catch {
      // Service may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`${label} did not become ready at ${url}.`);
}

await Promise.all([waitFor(`${apiUrl}/v1`, "API"), waitFor(webUrl, "Web")]);

const child = spawn("pnpm", ["tauri", "dev"], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    VITE_SHADOW_CLOUD_API_URL: apiUrl,
    VITE_SHADOW_CLOUD_WEB_URL: webUrl,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
