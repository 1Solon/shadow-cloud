import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import apiPackage from "../../../api/package.json";
import webPackage from "../../package.json";
import { componentVersionStatus } from "./component-versions";

describe("componentVersionStatus", () => {
  it("lists web and API versions without desktop", () => {
    expect(componentVersionStatus).toBe(
      `WEB: v${webPackage.version} / API: v${apiPackage.version}`,
    );
    expect(componentVersionStatus).not.toContain("DESKTOP");
  });

  it("copies API package metadata into the web Docker build context", () => {
    const dockerfile = readFileSync(
      new URL("../../Dockerfile", import.meta.url),
      "utf8",
    );

    expect(dockerfile).toContain(
      "COPY apps/api/package.json apps/api/package.json",
    );
  });
});
