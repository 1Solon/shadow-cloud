import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  choosePreviousTag,
  shouldPublishContainerImages,
  containerAffectingPaths,
} from "./detect-container-changes.mjs";

describe("shouldPublishContainerImages", () => {
  it("publishes manual dispatches even without changed files", () => {
    assert.equal(
      shouldPublishContainerImages({
        eventName: "workflow_dispatch",
        previousTag: "0.8.5",
        changedFiles: [],
      }),
      true,
    );
  });

  it("publishes the first release when no previous tag exists", () => {
    assert.equal(
      shouldPublishContainerImages({
        eventName: "release",
        previousTag: "",
        changedFiles: [],
      }),
      true,
    );
  });

  it("publishes release events with container-affecting changes", () => {
    assert.equal(
      shouldPublishContainerImages({
        eventName: "release",
        previousTag: "0.8.5",
        changedFiles: ["apps/api/src/main.ts"],
      }),
      true,
    );
  });

  it("skips release events without container-affecting changes", () => {
    assert.equal(
      shouldPublishContainerImages({
        eventName: "release",
        previousTag: "0.8.5",
        changedFiles: [],
      }),
      false,
    );
  });

  it("treats detector changes as container-affecting", () => {
    assert.ok(
      containerAffectingPaths.includes("scripts/detect-container-changes.mjs"),
    );
  });
});

describe("choosePreviousTag", () => {
  it("selects the newest reachable tag before the current release tag", () => {
    assert.equal(
      choosePreviousTag("0.8.6", ["0.8.6", "0.8.5", "0.8.4"]),
      "0.8.5",
    );
  });

  it("returns an empty tag when no previous reachable tag exists", () => {
    assert.equal(choosePreviousTag("0.1.0", ["0.1.0"]), "");
  });
});
