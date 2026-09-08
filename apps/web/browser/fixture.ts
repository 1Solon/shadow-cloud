import { test as base, expect } from "@playwright/test";
import { fork, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { encode } from "next-auth/jwt";
import { startUpstream } from "./upstream";

export const test = base.extend<{
  privilegedNonOverlord: boolean;
  campaign: {
    url: string;
    upstream: Awaited<ReturnType<typeof startUpstream>>;
  };
}>({
  privilegedNonOverlord: [false, { option: true }],
  campaign: [
    async ({ context, privilegedNonOverlord }, runTest, testInfo) => {
      const source = path.resolve(__dirname, "..");
      const snapshot = await mkdtemp(
        path.join(tmpdir(), "shadow-cloud-browser-"),
      );
      const secret = randomBytes(32).toString("hex");
      let child: ChildProcess | undefined;
      let upstream: Awaited<ReturnType<typeof startUpstream>> | undefined;
      let logs = "";
      try {
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
        for (const entry of ["package.json", "tsconfig.base.json"]) {
          await cp(
            path.join(source, "../..", entry),
            path.join(snapshot, entry),
          );
        }
        await symlink(
          path.join(source, "node_modules"),
          path.join(appRoot, "node_modules"),
          "junction",
        );
        upstream = await startUpstream(secret);
        if (privilegedNonOverlord) {
          upstream.game.organizerId = "browser-successor";
          upstream.game.organizerDisplayName = "Browser Successor";
          upstream.game.players.forEach((player) => {
            player.isOrganizer = player.userId === "browser-successor";
          });
        }
        child = fork(path.join(source, "browser/next-server.mjs"), [], {
          cwd: appRoot,
          execArgv: [],
          env: {
            PATH: process.env.PATH,
            HOME: path.join(snapshot, "home"),
            TMPDIR: snapshot,
            NODE_ENV: "development",
            NEXT_TELEMETRY_DISABLED: "1",
            AUTH_SECRET: secret,
            DISCORD_CLIENT_ID: "browser-test-not-an-oauth-client",
            DISCORD_CLIENT_SECRET: "browser-test-not-an-oauth-secret",
            SHADOW_CLOUD_API_URL: upstream.url,
            BROWSER_SNAPSHOT: snapshot,
          },
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        });
        child.stdout?.on("data", (chunk) => {
          logs += chunk;
        });
        child.stderr?.on("data", (chunk) => {
          logs += chunk;
        });
        const url = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error(`Next startup timed out.\n${logs}`)),
            90_000,
          );
          child!.once("message", (message: { url: string }) => {
            clearTimeout(timeout);
            resolve(message.url);
          });
          child!.once("error", (error) => {
            clearTimeout(timeout);
            reject(error);
          });
          child!.once("exit", (code) => {
            clearTimeout(timeout);
            reject(new Error(`Next exited (${code}).\n${logs}`));
          });
        });
        await context.addCookies([
          {
            name: "next-auth.session-token",
            value: await encode({
              secret,
              maxAge: 3600,
              token: {
                sub: "browser-overlord",
                userId: "browser-overlord",
                name: "Browser Overlord",
                email: "overlord@example.invalid",
                isShadowOverride: privilegedNonOverlord,
              },
            }),
            url,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        console.log(
          `Isolated Next ${url}; upstream ${upstream.url}; snapshot ${snapshot}`,
        );
        await runTest({ url, upstream });
      } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
          const exited = new Promise<void>((resolve) =>
            child!.once("exit", () => resolve()),
          );
          child.kill("SIGTERM");
          const force = setTimeout(() => child!.kill("SIGKILL"), 12_000);
          await exited;
          clearTimeout(force);
        }
        try {
          await upstream?.close();
        } finally {
          await rm(snapshot, { recursive: true, force: true });
        }
        if (testInfo.status !== testInfo.expectedStatus) {
          await testInfo.attach("next-server.log", {
            body: logs,
            contentType: "text/plain",
          });
          console.error(logs);
        }
        console.log(
          `Cleaned Next, upstream connections and snapshot ${snapshot}`,
        );
      }
    },
    { timeout: 150_000 },
  ],
});

export { expect };
