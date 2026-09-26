import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export default async function globalSetup() {
  const source = path.resolve(__dirname, "..");
  const snapshot = await mkdtemp(
    path.join(tmpdir(), "shadow-cloud-browser-build-"),
  );
  const appRoot = path.join(snapshot, "apps/web");
  await mkdir(appRoot, { recursive: true });
  await mkdir(path.join(snapshot, "home"));
  // Allowlist, not a checkout copy: never copy .env*, build caches or sessions.
  for (const entry of [
    "src",
    "public",
    "package.json",
    "tsconfig.json",
    "next.config.ts",
    "postcss.config.mjs",
  ]) {
    await cp(path.join(source, entry), path.join(appRoot, entry), {
      recursive: true,
      filter: (entry) => !path.basename(entry).startsWith(".env"),
    });
  }
  for (const entry of [
    "package.json",
    "tsconfig.base.json",
    "scripts/dev-env.mjs",
  ]) {
    await cp(path.join(source, "../..", entry), path.join(snapshot, entry));
  }
  await symlink(
    path.join(source, "node_modules"),
    path.join(appRoot, "node_modules"),
    "junction",
  );

  let logs = "";
  const build = spawn(
    process.execPath,
    [
      path.join(source, "node_modules/next/dist/bin/next"),
      "build",
      "--webpack",
    ],
    {
      cwd: appRoot,
      env: {
        PATH: process.env.PATH,
        HOME: path.join(snapshot, "home"),
        TMPDIR: snapshot,
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  build.stdout.on("data", (chunk) => {
    logs += chunk;
  });
  build.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  const code = await new Promise<number | null>((resolve, reject) => {
    build.once("error", reject);
    build.once("exit", resolve);
  });
  if (code !== 0) {
    await rm(snapshot, { recursive: true, force: true });
    throw new Error(`Next build exited (${code}).\n${logs}`);
  }

  process.env.BROWSER_BUILD = appRoot;
  return () => rm(snapshot, { recursive: true, force: true });
}
