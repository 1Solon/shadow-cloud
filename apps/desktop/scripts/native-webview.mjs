import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import axe from "axe-core";
import { startNativeFixture } from "./native-fixture.mjs";

// The actual Tauri/WebKitGTK boundary, with a private non-activating session bus
// and fresh application directories. Never restores the user's real vault/state.
assert.equal(
  process.platform,
  "linux",
  "This native webview runner targets Linux.",
);
const binary = path.resolve(
  process.argv[2] ??
    "apps/desktop/src-tauri/target/release/shadow-cloud-companion",
);
const root = await mkdtemp(path.join(tmpdir(), "companion-native-webview-"));
const output = process.env.COMPANION_NATIVE_OUTPUT ?? root;
await mkdir(output, { recursive: true });
const config = path.join(root, "bus.conf");
await writeFile(
  config,
  `<busconfig><type>session</type><listen>unix:tmpdir=/tmp</listen><auth>EXTERNAL</auth><policy context="default"><allow send_destination="*"/><allow receive_sender="*"/><allow own="*"/></policy></busconfig>`,
);
const children = [];
const executeFile = promisify(execFile);
let session;
let fixture;
const picker = process.argv.includes("--picker");
const port = Number(process.env.COMPANION_WEBDRIVER_PORT ?? 4447);
const base = `http://127.0.0.1:${port}`;
function launch(command, args, env = process.env, stdin = "ignore") {
  const child = spawn(command, args, {
    env,
    detached: true,
    stdio: [stdin, "pipe", "pipe"],
  });
  children.push(child);
  let log = "";
  child.stdout.on("data", (chunk) => {
    log = (log + chunk).slice(-65536);
  });
  child.stderr.on("data", (chunk) => {
    log = (log + chunk).slice(-65536);
  });
  child.on("error", (error) => {
    log = (log + error.message).slice(-65536);
  });
  child.diagnostics = () => log;
  return child;
}
async function trayHostBinary() {
  if (process.env.COMPANION_TRAY_HOST_BINARY)
    return process.env.COMPANION_TRAY_HOST_BINARY;
  const manifest = fileURLToPath(
    new URL("../src-tauri/Cargo.toml", import.meta.url),
  );
  const { stdout } = await executeFile(
    "cargo",
    [
      "test",
      "--manifest-path",
      manifest,
      "--lib",
      "--no-run",
      "--locked",
      "--message-format=json",
    ],
    { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000 },
  );
  const candidates = stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .filter(
      (message) =>
        message.reason === "compiler-artifact" &&
        message.target?.name === "shadow_cloud_companion_lib" &&
        message.profile?.test &&
        message.executable,
    );
  assert.equal(
    candidates.length,
    1,
    "One native integration helper executable",
  );
  return candidates[0].executable;
}
async function native(env, operation, ...args) {
  const helper = fileURLToPath(new URL("./native-linux.py", import.meta.url));
  const { stdout } = await executeFile(
    "python3",
    [helper, operation, ...args],
    { env, timeout: 10_000 },
  );
  return JSON.parse(stdout);
}
async function pickerAcceptance(env) {
  assert(
    fixture.requests.includes("GET /v1/companion/protocol"),
    "Development binary uses the isolated HTTP service",
  );
  await click("SIGN IN WITH BROWSER");
  await click("Didn't work?");
  const input = await request("POST", `/session/${session}/element`, {
    using: "css selector",
    value: "#handoff-token",
  });
  await request(
    "POST",
    `/session/${session}/element/${input["element-6066-11e4-a52e-4f735466cecf"]}/value`,
    { text: "native-synthetic-token" },
  );
  await click("CONNECT WITH TOKEN");
  await click("CONTINUE");
  await button("CHOOSE FOLDER");
  await click("CHOOSE FOLDER");
  await waitFor(
    () => native(env, "cancel-picker"),
    "real GTK folder picker opens and cancels",
  );
  await waitFor(
    () =>
      execute(
        "return document.body.innerText.includes('No Companion root was selected.')",
      ),
    "native picker cancellation reaches the engine and webview",
  );
  const snapshot = await request("POST", `/session/${session}/execute/async`, {
    script:
      "const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke('companion_snapshot').then(done);",
    args: [],
  });
  assert.equal(snapshot.rootPath, null);
  assert.equal(snapshot.onboarding.stage, "companion-root");
  assert.equal(
    snapshot.session.credentialStorage,
    "memory-only",
    "Private bus cannot activate the user's credential vault",
  );
  await accessible("native-picker-cancelled");
  const app = await native(env, "menu");
  await native(env, "click", "Quit");
  await waitFor(() => exited(app.pid), "synthetic authenticated app quits");
  session = undefined;
  console.log(
    "Native GTK folder picker cancellation passed through the real HTTP auth, engine command and WebKitGTK subscription seams.",
  );
}
async function trayAcceptance(env) {
  const initial = await waitFor(
    () => native(env, "menu"),
    "registered native tray menu",
  );
  for (const label of ["Open Companion", "Pause all", "Quit"]) {
    assert(
      initial.items.some((item) => item.label === label && item.enabled),
      `Native tray ${label}`,
    );
  }
  await native(env, "click", "Pause all");
  await waitFor(
    async () =>
      (await native(env, "menu")).items.some(
        (item) => item.label === "Resume all",
      ),
    "tray pause reaches the engine",
  );
  await native(env, "click", "Resume all");
  await waitFor(
    async () =>
      (await native(env, "menu")).items.some(
        (item) => item.label === "Pause all",
      ),
    "tray resume reaches the engine",
  );
  await native(env, "close");
  await waitFor(
    async () => !(await native(env, "window")).visible,
    "close hides the window in the native tray",
  );
  await native(env, "click", "Open Companion");
  await waitFor(
    async () => (await native(env, "window")).visible,
    "tray Open restores window",
  );
  await native(env, "close");
  await waitFor(
    async () => !(await native(env, "window")).visible,
    "window hidden before second instance",
  );
  const second = launch(binary, [], env);
  await waitFor(
    () => second.exitCode === 0,
    "second instance exits successfully",
  );
  const focused = await waitFor(async () => {
    const state = await native(env, "window");
    return state.visible && state.focused ? state : false;
  }, "single instance restores and focuses original window");
  assert.equal(
    focused.pid,
    initial.pid,
    "Second launch retains the original app process",
  );
  await native(env, "close");
  await waitFor(
    async () => !(await native(env, "window")).visible,
    "window hidden before losing tray host",
  );
  await native(env, "host", "false");
  await waitFor(
    async () => (await native(env, "window")).visible,
    "lost tray host restores hidden window",
  );
  await waitFor(
    () => execute("return document.visibilityState === 'visible'"),
    "restored webview visibility",
  );
  await request("POST", `/session/${session}/actions`, {
    actions: [
      {
        type: "pointer",
        id: "native-mouse",
        parameters: { pointerType: "mouse" },
        actions: [
          {
            type: "pointerMove",
            duration: 100,
            origin: "viewport",
            x: 600,
            y: 50,
          },
        ],
      },
    ],
  });
  await accessible("native-tray-host-lost-settled");
  await native(env, "close");
  await waitFor(
    () => exited(initial.pid),
    "closing without a tray host quits safely",
  );
  await request("DELETE", `/session/${session}`).catch(() => {});
  session = undefined;
  await native(env, "host", "true");
  const reopened = await request("POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application: binary } } },
  });
  session = reopened.sessionId;
  const restarted = await waitFor(
    () => native(env, "menu"),
    "restarted native tray",
  );
  await native(env, "click", "Quit");
  await waitFor(
    () => exited(restarted.pid),
    "native tray Quit exits application",
  );
  // Quit already closed the native session; the driver is cleaned up below.
  session = undefined;
  console.log(
    "Native tray Open/Pause/Resume/Quit, close-to-tray, host-loss recovery, close without a host, and single-instance focus passed.",
  );
}
function exited(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
}
async function request(method, endpoint, body) {
  const response = await fetch(base + endpoint, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await response.json();
  assert(response.ok && !json.value?.error, JSON.stringify(json.value));
  return json.value;
}
async function waitFor(check, label) {
  let last;
  for (let n = 0; n < 80; n++) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`, { cause: last });
}
const execute = (script, args = []) =>
  request("POST", `/session/${session}/execute/sync`, { script, args });
async function button(text) {
  return waitFor(async () => {
    const result = await request("POST", `/session/${session}/element`, {
      using: "xpath",
      value: `//button[normalize-space(.)=${JSON.stringify(text)}]`,
    });
    return result["element-6066-11e4-a52e-4f735466cecf"];
  }, text);
}
async function click(text) {
  const id = await button(text);
  await request("POST", `/session/${session}/element/${id}/click`, {});
}
async function accessible(label) {
  // View transitions deliberately fade text. Measure its settled rendered state
  // while retaining every contrast rule; infinite decorative animation may run.
  await request("POST", `/session/${session}/execute/async`, {
    script: `
    const done=arguments[arguments.length-1];
    (async()=>{
      await document.fonts.ready;
      const finite=document.getAnimations().filter(a=>Number.isFinite(a.effect.getComputedTiming().endTime));
      await Promise.allSettled(finite.map(a=>a.finished));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      done(true);
    })().catch(e=>done({error:String(e)}));`,
    args: [],
  });
  const violations = await request(
    "POST",
    `/session/${session}/execute/async`,
    {
      script: `${axe.source}; const done=arguments[arguments.length-1]; axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>done(r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))),e=>done([{error:String(e)}]));`,
      args: [],
    },
  );
  const png = await request("GET", `/session/${session}/screenshot`);
  await writeFile(
    path.join(output, `${label}.png`),
    Buffer.from(png, "base64"),
  );
  assert.deepEqual(violations, [], `${label} accessibility`);
  assert(
    await execute("return document.documentElement.scrollWidth<=innerWidth+1"),
    `${label} horizontal overflow`,
  );
}
try {
  const bus = launch("dbus-daemon", [
    "--nofork",
    "--print-address=1",
    "--config-file",
    config,
  ]);
  const address = await waitFor(
    () =>
      bus
        .diagnostics()
        .split("\n")
        .find((line) => line.startsWith("unix:")),
    "private session bus",
  );
  const env = {
    ...process.env,
    DBUS_SESSION_BUS_ADDRESS: address,
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    XDG_CACHE_HOME: path.join(root, "cache"),
    TAURI_WEBVIEW_AUTOMATION: "true",
    COMPANION_NATIVE_PRIVATE_BUS: "true",
    GDK_BACKEND: "x11",
  };
  if (picker) {
    const { version } = JSON.parse(
      await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
    );
    fixture = await startNativeFixture(version);
    env.SHADOW_CLOUD_API_URL = fixture.url;
    env.SHADOW_CLOUD_WEB_URL = fixture.url;
    const vite = launch(
      "pnpm",
      [
        "--filter",
        "@shadow-cloud/desktop",
        "exec",
        "vite",
        "--host",
        "127.0.0.1",
        "--port",
        "1437",
        "--strictPort",
      ],
      env,
    );
    await waitFor(
      () => vite.diagnostics().includes("http://127.0.0.1:1437"),
      "isolated development webview source",
    );
  }
  const host = launch(
    await trayHostBinary(),
    [
      "--exact",
      "native_tests::tray_host::isolated_status_notifier_host",
      "--ignored",
      "--nocapture",
    ],
    { ...env, SHADOW_CLOUD_NATIVE_TRAY_HOST: "true" },
    "pipe",
  );
  await waitFor(
    () => host.diagnostics().includes("SHADOW_CLOUD_TRAY_HOST_READY"),
    "isolated StatusNotifierWatcher",
  );
  launch(
    "tauri-driver",
    [
      "--port",
      String(port),
      "--native-port",
      String(port + 1),
      "--native-host",
      "127.0.0.1",
    ],
    env,
  );
  await waitFor(() => request("GET", "/status"), "native driver");
  const opened = await request("POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application: binary } } },
  });
  session = opened.sessionId;
  await request("POST", `/session/${session}/timeouts`, {
    implicit: 0,
    script: 15000,
    pageLoad: 20000,
  });
  await button("BEGIN SETUP");
  if (picker)
    await waitFor(
      () => fixture.requests.includes("GET /v1/companion/protocol"),
      "isolated native protocol request",
    );
  await accessible("native-welcome");
  await click("BEGIN SETUP");
  await waitFor(
    () =>
      execute("return document.body.innerText.includes('CONNECT THIS DEVICE')"),
    "native engine command subscription",
  );
  await accessible("native-connect");
  await request("POST", `/session/${session}/window/rect`, {
    width: 640,
    height: 640,
  });
  await accessible("native-compact");
  const headingFocused = await execute(
    "return document.activeElement?.matches('h1,h2,h3') && document.activeElement.textContent.includes('CONNECT THIS DEVICE')",
  );
  assert(headingFocused, "Setup navigation focuses its heading");
  if (picker) await pickerAcceptance(env);
  else await trayAcceptance(env);
  console.log(
    `Native Tauri/WebKitGTK welcome, command/subscription, compact layout and axe checks passed. Screenshots: ${output}`,
  );
} catch (error) {
  if (session) {
    const screen = await request("GET", `/session/${session}/screenshot`).catch(
      () => undefined,
    );
    if (screen)
      await writeFile(
        path.join(output, "native-failure.png"),
        Buffer.from(screen, "base64"),
      );
    const text = await execute("return document.body.innerText").catch(
      () => "",
    );
    await writeFile(path.join(output, "native-failure.txt"), text);
  }
  if (fixture)
    await writeFile(
      path.join(output, "native-fixture-requests.json"),
      JSON.stringify(fixture.requests),
    );
  await writeFile(
    path.join(output, "native-process.log"),
    children.map((child) => child.diagnostics()).join("\n"),
  );
  throw error;
} finally {
  await fixture?.close();
  if (session) await request("DELETE", `/session/${session}`).catch(() => {});
  for (const child of children.reverse()) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
}
