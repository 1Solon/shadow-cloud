import { rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const appRoot = process.cwd();
const isWindows = process.platform === "win32";

function run(command, args) {
  const result = isWindows
    ? spawnSync("cmd.exe", ["/c", command, ...args], {
        cwd: appRoot,
        env: process.env,
        stdio: "inherit",
      })
    : spawnSync(command, args, {
        cwd: appRoot,
        env: process.env,
        stdio: "inherit",
      });

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

for (const relativePath of [".next/types", ".next/dev/types"]) {
  rmSync(path.join(appRoot, relativePath), { force: true, recursive: true });
}

run("pnpm", ["exec", "next", "typegen"]);
run("pnpm", ["exec", "tsc", "--noEmit"]);
