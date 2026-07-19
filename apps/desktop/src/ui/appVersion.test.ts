import { describe, expect, it } from "vitest";
import rootPackage from "../../../../package.json";
import { desktopVersion } from "./appVersion";

describe("desktopVersion", () => {
  it("uses the unified root package version", () => {
    expect(desktopVersion).toBe(rootPackage.version);
    expect(desktopVersion).not.toBe("unknown");
  });
});
