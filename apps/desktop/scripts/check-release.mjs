import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const release = JSON.parse(read("package.json")).version;
const expected = process.env.RELEASE_VERSION ?? release;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(expected))
  throw new Error("Expected a semantic release version.");
const configPath = "apps/desktop/src-tauri/tauri.conf.json";
const config = JSON.parse(read(configPath));
const bundleVersion = config.version.endsWith(".json")
  ? JSON.parse(read(resolve(root, dirname(configPath), config.version))).version
  : config.version;
const cargo = read("apps/desktop/src-tauri/Cargo.toml").match(
  /\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/,
)?.[1];
const lock = read("apps/desktop/src-tauri/Cargo.lock").match(
  /\[\[package\]\]\r?\nname\s*=\s*"shadow-cloud-companion"\r?\nversion\s*=\s*"([^"]+)"/,
)?.[1];
for (const [source, version] of Object.entries({
  repository: release,
  bundle: bundleVersion,
  cargo,
  lock,
})) {
  if (version !== expected)
    throw new Error(
      `${source} version ${version} does not match release ${expected}. Bump versions in source before publishing.`,
    );
}
if (config.identifier !== "com.shadowcloud.companion")
  throw new Error("Incorrect Companion application identity.");
console.log(
  `Companion bundle and protocol match repository release ${release}.`,
);
