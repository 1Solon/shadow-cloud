import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const execute = promisify(execFile);
const metadataLimit = 1024 * 1024;
const signatureLimit = 16 * 1024;
const artifactLimit = 512 * 1024 * 1024;
const notice =
  "OS publisher signing and macOS notarization are deferred; installers are unsigned by an OS publisher. Tauri updater signatures are mandatory.";

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function decoded(value, description) {
  requireThat(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= signatureLimit &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value.trim(),
      ),
    `Invalid ${description}.`,
  );
  return Buffer.from(value.trim(), "base64");
}

function releaseAssets(release, repository, tag, version, stableOnly) {
  requireThat(/^[\w.-]+\/[\w.-]+$/.test(repository), "Invalid repository.");
  requireThat(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) &&
      tag.replace(/^v/, "") === version,
    "Tag must identify the exact semantic version.",
  );
  requireThat(
    release.tag_name === tag && release.draft === false,
    "Expected the exact published release.",
  );
  const preview = version.split("+")[0].includes("-");
  requireThat(
    release.prerelease === preview,
    "Release channel does not match its version.",
  );
  requireThat(!stableOnly || !preview, "Prereleases cannot deploy production.");
  requireThat(Array.isArray(release.assets), "Release assets are missing.");
  const assets = new Map();
  const identifiers = new Set();
  for (const asset of release.assets) {
    requireThat(
      Number.isSafeInteger(asset.id) &&
        asset.id > 0 &&
        typeof asset.name === "string" &&
        !assets.has(asset.name) &&
        !identifiers.has(asset.id),
      "Invalid or duplicate release asset.",
    );
    requireThat(
      asset.browser_download_url ===
        `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset.name)}`,
      "Asset URL is not bound to the exact repository and release tag.",
    );
    requireThat(
      Number.isSafeInteger(asset.size) &&
        asset.size > 0 &&
        asset.size <= artifactLimit &&
        asset.state === "uploaded",
      `Asset is incomplete: ${asset.name}.`,
    );
    assets.set(asset.name, asset);
    identifiers.add(asset.id);
  }
  return assets;
}

/** Validate the release contract with real minisign verification, without publishing. */
export async function verifyRelease({
  release,
  repository,
  tag,
  version,
  publicKey,
  loadAsset,
  metadata,
  stableOnly = false,
  minisign = process.env.MINISIGN_BINARY ?? "minisign",
  signal,
}) {
  const assets = releaseAssets(release, repository, tag, version, stableOnly);
  // tauri-action sanitizes '+' in GitHub filenames; metadata keeps exact SemVer.
  const filenameVersion = version
    .replace(/[^a-zA-Z0-9_-]/g, ".")
    .replace(/\.\./g, ".");
  const prefix = `Shadow.Cloud.Companion_${filenameVersion}_`;
  const select = (suffix) => {
    const matches = [...assets.values()].filter(
      (asset) =>
        asset.name.startsWith(prefix) &&
        suffix.test(asset.name.slice(prefix.length)),
    );
    requireThat(
      matches.length === 1,
      `Expected one ${suffix} installer/update artifact.`,
    );
    return matches[0];
  };
  const linux = select(/^linux_(?:x64|x86_64|amd64)_unsigned\.AppImage$/);
  const windows = select(/^windows_(?:x64|x86_64|amd64)_unsigned-setup\.exe$/);
  const mac = select(/^darwin_universal_unsigned\.app\.tar\.gz$/);
  select(/^darwin_universal_unsigned\.dmg$/);
  const platforms = {
    "linux-x86_64": linux,
    "windows-x86_64": windows,
    "darwin-x86_64": mac,
    "darwin-aarch64": mac,
  };
  if (metadata !== undefined) {
    requireThat(
      metadata.version === version,
      "Updater metadata version differs from release.",
    );
    requireThat(
      metadata.platforms &&
        Object.keys(metadata.platforms).sort().join() ===
          Object.keys(platforms).sort().join(),
      "Updater metadata must contain every required target and no unexpected targets.",
    );
  }
  const temporary = await mkdtemp(join(tmpdir(), "companion-release-verify-"));
  const verified = new Map();
  const result = { version, notes: notice, platforms: {} };
  try {
    const keyFile = join(temporary, "updater.pub");
    await writeFile(
      keyFile,
      decoded(publicKey, "configured updater public key"),
    );
    for (const [target, asset] of Object.entries(platforms)) {
      signal?.throwIfAborted();
      if (!verified.has(asset.id)) {
        const signature = assets.get(`${asset.name}.sig`);
        requireThat(signature, `Missing updater signature: ${asset.name}.`);
        const signatureText = (await loadAsset(signature, signatureLimit))
          .toString("utf8")
          .trim();
        const signedBytes = await loadAsset(asset, artifactLimit);
        requireThat(
          signedBytes.length === asset.size,
          `Incomplete download: ${asset.name}.`,
        );
        const artifactFile = join(temporary, `${asset.id}.artifact`);
        const signatureFile = join(temporary, `${asset.id}.minisig`);
        await writeFile(artifactFile, signedBytes);
        await writeFile(
          signatureFile,
          decoded(signatureText, "updater signature"),
        );
        try {
          await execute(
            minisign,
            [
              "-V",
              "-q",
              "-p",
              keyFile,
              "-x",
              signatureFile,
              "-m",
              artifactFile,
            ],
            {
              timeout: 30_000,
              signal,
            },
          );
        } catch {
          throw new Error(
            `Updater signature verification failed: ${asset.name}.`,
          );
        }
        verified.set(asset.id, signatureText);
      }
      const entry = {
        url: asset.browser_download_url,
        signature: verified.get(asset.id),
      };
      if (metadata !== undefined) {
        requireThat(
          metadata.platforms[target]?.url === entry.url,
          `Updater URL is not the exact release artifact for ${target}.`,
        );
        requireThat(
          metadata.platforms[target]?.signature?.trim() === entry.signature,
          `Updater metadata and .sig disagree for ${target}.`,
        );
      }
      result.platforms[target] = entry;
    }
    return result;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function request(
  url,
  limit,
  signal,
  accept = "application/vnd.github+json",
) {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": "Shadow-Cloud-Companion-Release-Verification",
      ...(process.env.GH_TOKEN
        ? { Authorization: `Bearer ${process.env.GH_TOKEN}` }
        : {}),
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  });
  requireThat(
    response.ok,
    `GitHub release request failed (HTTP ${response.status}).`,
  );
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    requireThat(size <= limit, "Release response exceeded the size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function main() {
  const { values } = parseArgs({
    options: {
      repository: { type: "string" },
      tag: { type: "string" },
      version: { type: "string" },
      "wait-seconds": { type: "string", default: "0" },
      "write-metadata": { type: "string" },
      "stable-only": { type: "boolean", default: false },
    },
  });
  const { repository, tag, version } = values;
  requireThat(
    repository && tag && version,
    "Usage: verify-release.mjs --repository owner/repo --tag tag --version version [--write-metadata file | --wait-seconds 1800] [--stable-only]",
  );
  requireThat(/^[\w.-]+\/[\w.-]+$/.test(repository), "Invalid repository.");
  const wait = Number(values["wait-seconds"]);
  requireThat(
    Number.isInteger(wait) && wait >= 0 && wait <= 1800,
    "Wait must be between 0 and 1800 seconds.",
  );
  const signal = AbortSignal.timeout(wait > 0 ? wait * 1000 : 10 * 60 * 1000);
  const config = JSON.parse(
    await readFile(
      new URL("../src-tauri/tauri.conf.json", import.meta.url),
      "utf8",
    ),
  );
  while (true) {
    try {
      const release = JSON.parse(
        await request(
          `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
          metadataLimit,
          signal,
        ),
      );
      const loadAsset = (asset, limit) =>
        request(
          `https://api.github.com/repos/${repository}/releases/assets/${asset.id}`,
          limit,
          signal,
          "application/octet-stream",
        );
      let metadata;
      if (!values["write-metadata"]) {
        const assets = releaseAssets(
          release,
          repository,
          tag,
          version,
          values["stable-only"],
        );
        const latest = assets.get("latest.json");
        requireThat(
          latest,
          "Complete updater metadata has not been published yet.",
        );
        metadata = JSON.parse(await loadAsset(latest, metadataLimit));
      }
      const verified = await verifyRelease({
        release,
        repository,
        tag,
        version,
        loadAsset,
        metadata,
        signal,
        publicKey: config.plugins.updater.pubkey,
        stableOnly: values["stable-only"],
      });
      if (values["write-metadata"]) {
        await writeFile(
          resolve(values["write-metadata"]),
          `${JSON.stringify(verified, null, 2)}\n`,
        );
      }
      console.log(
        `Verified ${tag}: Windows x64 NSIS, universal macOS DMG/update, Linux x64 AppImage, and all updater signatures. ${notice}`,
      );
      return;
    } catch (error) {
      if (wait === 0 || signal.aborted) throw error;
      console.log(
        `Desktop release is not ready: ${error.message} Retrying in 30 seconds.`,
      );
      await delay(30_000, undefined, { signal });
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main().catch((error) => {
    console.error(`Desktop release verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
