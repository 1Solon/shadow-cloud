import { describe, expect, it } from "vitest";
import { getErrorMessage } from "./error-message";

describe("getErrorMessage", () => {
  it("preserves string errors thrown by Tauri invoke commands", () => {
    expect(
      getErrorMessage("protocol registration is unavailable", "Fallback"),
    ).toBe("protocol registration is unavailable");
  });

  it("preserves Error object messages", () => {
    expect(getErrorMessage(new Error("network failed"), "Fallback")).toBe(
      "network failed",
    );
  });

  it("uses the fallback for empty or unhelpful values", () => {
    expect(getErrorMessage("", "Fallback")).toBe("Fallback");
    expect(getErrorMessage(null, "Fallback")).toBe("Fallback");
  });
});
