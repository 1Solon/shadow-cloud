import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import rootPackage from "../../../../package.json";
import {
  applicationVersion,
  resolveApplicationVersion,
} from "./component-versions";

describe("applicationVersion", () => {
  it("defaults to the root package version", () => {
    expect(applicationVersion).toBe(rootPackage.version);
  });

  it("allows release builds to inject the git release tag", () => {
    expect(resolveApplicationVersion({ SHADOW_CLOUD_VERSION: "1.2.3" })).toBe(
      "1.2.3",
    );
  });

  it("passes the release version into the web Docker image", () => {
    const dockerfile = readFileSync(
      new URL("../../Dockerfile", import.meta.url),
      "utf8",
    );

    expect(dockerfile).toContain("ARG SHADOW_CLOUD_VERSION");
    expect(dockerfile).toContain(
      "ENV SHADOW_CLOUD_VERSION=$SHADOW_CLOUD_VERSION",
    );
  });
});
