import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const containerAffectingPaths = [
  ".dockerignore",
  "docker-compose.yml",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "apps/api",
  "apps/bot",
  "apps/web",
  "packages",
  ".github/workflows/publish-container.yml",
  "scripts/detect-container-changes.mjs",
];

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  if (value.includes("\n")) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `${name}<<__shadow_cloud_output__\n${value}\n__shadow_cloud_output__\n`,
    );
    return;
  }

  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

export function shouldPublishContainerImages({
  eventName,
  previousTag,
  changedFiles,
}) {
  if (eventName === "workflow_dispatch") {
    return true;
  }

  if (!previousTag) {
    return true;
  }

  return changedFiles.length > 0;
}

export function choosePreviousTag(currentTag, reachableTags) {
  return reachableTags.find((tag) => tag !== currentTag) ?? "";
}

export function resolvePreviousReachableTag(currentTag) {
  try {
    const reachableTags = runGit([
      "tag",
      "--merged",
      `${currentTag}^`,
      "--sort=-creatordate",
    ])
      .split("\n")
      .map((tag) => tag.trim())
      .filter(Boolean);

    return choosePreviousTag(currentTag, reachableTags);
  } catch {
    return "";
  }
}

export function listChangedContainerFiles(previousTag, currentTag) {
  if (!previousTag) {
    return [];
  }

  return runGit([
    "diff",
    "--name-only",
    previousTag,
    currentTag,
    "--",
    ...containerAffectingPaths,
  ])
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);
}

export function detectContainerChanges({
  eventName = process.env.GITHUB_EVENT_NAME ?? "",
  currentTag = process.env.GITHUB_REF_NAME ?? "",
} = {}) {
  if (eventName === "workflow_dispatch") {
    return {
      shouldPublish: true,
      previousTag: "",
      changedFiles: [],
    };
  }

  if (!currentTag) {
    throw new Error("Could not determine the current release tag.");
  }

  const previousTag = resolvePreviousReachableTag(currentTag);
  const changedFiles = listChangedContainerFiles(previousTag, currentTag);

  return {
    shouldPublish: shouldPublishContainerImages({
      eventName,
      previousTag,
      changedFiles,
    }),
    previousTag,
    changedFiles,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = detectContainerChanges();
  const changedFilesText = result.changedFiles.join("\n");

  console.log(
    result.previousTag
      ? `Comparing container paths from ${result.previousTag} to ${process.env.GITHUB_REF_NAME}.`
      : "No previous reachable tag found; publishing container images.",
  );
  console.log(
    changedFilesText.length > 0
      ? `Container-affecting files changed:\n${changedFilesText}`
      : "No container-affecting file changes detected.",
  );

  writeOutput("should_publish", String(result.shouldPublish));
  writeOutput("previous_tag", result.previousTag);
  writeOutput("changed_files", changedFilesText);
}
