import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const executable = resolve(process.argv[2] ?? "");
if (!process.argv[2])
  throw new Error("Usage: node smoke-native.mjs <executable> [args...]");
await access(executable);
const child = spawn(executable, process.argv.slice(3), {
  stdio: ["ignore", "pipe", "pipe"],
  // AppImage launchers and webviews create descendants. Give this smoke check
  // its own process group so cleanup cannot leave a background application.
  detached: process.platform !== "win32",
});
let output = "";
let stopping = false;
let killTimer;
const capture = (chunk) => {
  output = (output + chunk).slice(-8000);
};
child.stdout.on("data", capture);
child.stderr.on("data", capture);

function stop(signal) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

// This catches missing loaders/libraries and early native crashes, not rendering.
const startup = setTimeout(() => {
  stopping = true;
  stop("SIGTERM");
  killTimer = setTimeout(() => stop("SIGKILL"), 3000);
}, 10_000);
const stopTimers = () => {
  clearTimeout(startup);
  clearTimeout(killTimer);
};
child.on("error", (error) => {
  stopTimers();
  console.error(error.message);
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  stopTimers();
  if (!stopping) {
    console.error(
      `Native application exited during startup (${code ?? signal}).\n${output}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      "Native process remained alive for 10 seconds. Rendering and OS integration were not asserted.",
    );
  }
});
