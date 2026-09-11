import { spawn } from "node:child_process";
import { loadRootEnv } from "../../../scripts/dev-env.mjs";

await loadRootEnv();

// The native process owns networking. Start even when the server is offline.
const child = spawn("pnpm", ["tauri", "dev"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    SHADOW_CLOUD_API_URL:
      process.env.SHADOW_CLOUD_API_URL ?? "http://127.0.0.1:3001",
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
