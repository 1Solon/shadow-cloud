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
});
