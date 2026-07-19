import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import rootPackage from "../../../../package.json";
import {
  componentVersionStatus,
  resolveApplicationVersion,
} from "./component-versions";

describe("componentVersionStatus", () => {
  it("shows one application-wide version", () => {
    expect(componentVersionStatus).toBe(`VERSION: v${rootPackage.version}`);
    expect(componentVersionStatus).not.toContain("WEB:");
    expect(componentVersionStatus).not.toContain("API:");
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
