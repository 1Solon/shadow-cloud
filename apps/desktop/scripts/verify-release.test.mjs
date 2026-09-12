import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyRelease } from "./verify-release.mjs";

const minisign = process.env.MINISIGN_BINARY ?? "minisign";

async function fixture(t, version = "0.16.1") {
  const directory = await mkdtemp(join(tmpdir(), "companion-release-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const publicFile = join(directory, "synthetic.pub");
  const secretFile = join(directory, "synthetic.key");
  execFileSync(minisign, ["-G", "-W", "-p", publicFile, "-s", secretFile], {
    stdio: "pipe",
  });
  const publicKey = (await readFile(publicFile)).toString("base64");
  const repository = "synthetic/companion";
  const tag = `v${version}`;
  const release = {
    tag_name: tag,
    draft: false,
    prerelease: version.includes("-"),
    assets: [],
  };
  const contents = new Map();
  const add = (name, bytes) => {
    const asset = {
      id: release.assets.length + 1,
      name,
      size: bytes.length,
      state: "uploaded",
      browser_download_url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`,
    };
    release.assets.push(asset);
    contents.set(asset.id, bytes);
    return asset;
  };
  for (const suffix of [
    "linux_amd64_unsigned.AppImage",
    "windows_x64_unsigned-setup.exe",
    "darwin_universal_unsigned.app.tar.gz",
    "darwin_universal_unsigned.dmg",
  ]) {
    const name = `Shadow.Cloud.Companion_${version}_${suffix}`;
    const bytes = Buffer.from(`synthetic immutable ${name} contents`);
    add(name, bytes);
    if (suffix.endsWith(".dmg")) continue;
    const artifactFile = join(directory, name);
    const signatureFile = `${artifactFile}.minisig`;
    await writeFile(artifactFile, bytes);
    execFileSync(
      minisign,
      [
        "-S",
        // Exercise both legacy and current prehashed minisign signatures.
        ...(suffix.startsWith("darwin") ? ["-l"] : []),
        "-s",
        secretFile,
        "-m",
        artifactFile,
        "-x",
        signatureFile,
      ],
      { stdio: "pipe" },
    );
    add(
      `${name}.sig`,
      Buffer.from((await readFile(signatureFile)).toString("base64")),
    );
  }
  const loadAsset = async (asset, limit) => {
    const bytes = contents.get(asset.id);
    assert.ok(bytes.length <= limit);
    return bytes;
  };
  const options = {
    release,
    repository,
    tag,
    version,
    publicKey,
    loadAsset,
    minisign,
  };
  const metadata = await verifyRelease(options);
  return { options, metadata, contents };
}

test("complete stable and preview releases use real signed bytes for every updater target", async (t) => {
  for (const version of ["0.16.1", "0.16.2-preview.1"]) {
    const { options, metadata } = await fixture(t, version);
    assert.deepEqual(await verifyRelease({ ...options, metadata }), metadata);
    assert.equal(Object.keys(metadata.platforms).length, 4);
    assert.equal(
      metadata.platforms["darwin-x86_64"].url,
      metadata.platforms["darwin-aarch64"].url,
    );
    assert.match(metadata.notes, /unsigned/);
    assert.match(metadata.notes, /notarization.*deferred/);
  }
});

test("missing installers, signatures, or target metadata cannot pass the release gate", async (t) => {
  const { options, metadata } = await fixture(t);
  for (const suffix of [
    ".exe",
    ".dmg",
    ".AppImage",
    ".app.tar.gz",
    ".AppImage.sig",
  ]) {
    const release = structuredClone(options.release);
    release.assets = release.assets.filter(
      (asset) => !asset.name.endsWith(suffix),
    );
    await assert.rejects(
      verifyRelease({ ...options, release, metadata }),
      /Expected one|Missing updater signature/,
    );
  }
  const partial = structuredClone(metadata);
  delete partial.platforms["darwin-aarch64"];
  await assert.rejects(
    verifyRelease({ ...options, metadata: partial }),
    /every required target/,
  );
});

test("metadata must select exact repository, release, version and artifact", async (t) => {
  const { options, metadata } = await fixture(t);
  for (const url of [
    metadata.platforms["linux-x86_64"].url.replace(
      "synthetic/companion",
      "untrusted/companion",
    ),
    metadata.platforms["linux-x86_64"].url.replace("v0.16.1", "v0.16.0"),
    metadata.platforms["windows-x86_64"].url,
    `${metadata.platforms["linux-x86_64"].url}?alternate=1`,
  ]) {
    const changed = structuredClone(metadata);
    changed.platforms["linux-x86_64"].url = url;
    await assert.rejects(
      verifyRelease({ ...options, metadata: changed }),
      /exact release artifact/,
    );
  }
  await assert.rejects(
    verifyRelease({ ...options, metadata: { ...metadata, version: "0.16.0" } }),
    /version differs/,
  );
  const release = structuredClone(options.release);
  release.assets[0].browser_download_url =
    "https://untrusted.example/installer";
  await assert.rejects(
    verifyRelease({ ...options, release, metadata }),
    /exact repository and release tag/,
  );
});

test("matching signature text is insufficient when bytes, key or signatures change", async (t) => {
  const { options, metadata, contents } = await fixture(t);
  const artifact = options.release.assets.find((asset) =>
    asset.name.endsWith(".AppImage"),
  );
  const original = contents.get(artifact.id);
  const changed = Buffer.from(original);
  changed[0] ^= 1;
  contents.set(artifact.id, changed);
  await assert.rejects(
    verifyRelease({ ...options, metadata }),
    /signature verification failed/,
  );
  contents.set(artifact.id, original);

  const another = await fixture(t);
  await assert.rejects(
    verifyRelease({
      ...options,
      metadata,
      publicKey: another.options.publicKey,
    }),
    /signature verification failed/,
  );
  const altered = structuredClone(metadata);
  altered.platforms["linux-x86_64"].signature =
    altered.platforms["windows-x86_64"].signature;
  await assert.rejects(
    verifyRelease({ ...options, metadata: altered }),
    /metadata and .sig disagree/,
  );
  const signature = options.release.assets.find(
    (asset) => asset.name === `${artifact.name}.sig`,
  );
  contents.set(
    signature.id,
    Buffer.from(altered.platforms["linux-x86_64"].signature),
  );
  await assert.rejects(
    verifyRelease({ ...options, metadata: altered }),
    /signature verification failed/,
  );
});

test("production excludes previews and drafts, and downloads must be complete", async (t) => {
  const preview = await fixture(t, "0.16.2-preview.1");
  await assert.rejects(
    verifyRelease({
      ...preview.options,
      metadata: preview.metadata,
      stableOnly: true,
    }),
    /Prereleases cannot deploy production/,
  );
  const { options, metadata, contents } = await fixture(t);
  await assert.rejects(
    verifyRelease({
      ...options,
      metadata,
      release: { ...options.release, draft: true },
    }),
    /exact published release/,
  );
  const asset = options.release.assets[0];
  contents.set(asset.id, contents.get(asset.id).subarray(1));
  await assert.rejects(
    verifyRelease({ ...options, metadata }),
    /Incomplete download/,
  );
});
