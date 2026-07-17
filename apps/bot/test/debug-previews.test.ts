import { ComponentType, MessageFlags } from "discord.js";
import { describe, expect, it } from "vitest";
import {
  buildDebugPreviews,
  debugPreviewNames,
  selectDebugPreviewNames,
} from "../src/debug-previews.js";

const context = {
  userId: "user-1",
  userDisplayName: "Debug User",
  webBaseUrl: "https://shadow.example",
};

describe("selectDebugPreviewNames", () => {
  it("registers every production notification and response outcome", () => {
    expect(debugPreviewNames).toEqual([
      "game-initialized",
      "turn-notification",
      "save-replaced",
      "turn-reminder",
      "registration-approval",
      "registration-approved",
      "registration-rejected",
      "registration-submitted",
      "resignation-complete",
      "resignation-announcement",
      "seat-filled",
      "seat-filled-announcement",
      "turn-skipped",
      "turn-advanced",
      "game-link",
      "message-pinned",
      "message-unpinned",
      "wrong-channel",
      "forum-thread-required",
      "bot-misconfigured",
      "initialization-failed",
      "registration-failed",
      "resignation-failed",
      "replacement-failed",
      "skip-failed",
      "link-failed",
      "pin-failed",
      "unpin-failed",
      "invalid-message",
      "discord-pin-failed",
      "discord-unpin-failed",
      "shadow-cloud-unavailable",
      "approval-failed",
      "rejection-failed",
    ]);
  });

  it("selects all previews for omitted or blank input", () => {
    expect(selectDebugPreviewNames(null)).toEqual({
      ok: true,
      names: debugPreviewNames,
    });
    expect(selectDebugPreviewNames(" , ")).toEqual({
      ok: true,
      names: debugPreviewNames,
    });
  });

  it("normalizes, deduplicates, and returns registry order", () => {
    expect(
      selectDebugPreviewNames(" TURN-REMINDER,game-initialized,turn-reminder "),
    ).toEqual({
      ok: true,
      names: ["game-initialized", "turn-reminder"],
    });
  });

  it("rejects all selected previews when any name is unknown", () => {
    expect(selectDebugPreviewNames("turn-reminder,missing,MISSING")).toEqual({
      ok: false,
      unknownNames: ["missing"],
    });
  });
});

describe("buildDebugPreviews", () => {
  it("renders every registered preview as ephemeral Components V2", () => {
    const previews = buildDebugPreviews(debugPreviewNames, context);

    expect(previews.map((preview) => preview.name)).toEqual(debugPreviewNames);
    for (const preview of previews) {
      expect(
        Number(preview.message.flags) & MessageFlags.Ephemeral,
      ).toBeTruthy();
      expect(
        Number(preview.message.flags) & MessageFlags.IsComponentsV2,
      ).toBeTruthy();
      expect(preview.message.components).toHaveLength(1);
    }
  });

  it("uses disabled buttons for the registration approval preview", () => {
    const preview = buildDebugPreviews(["registration-approval"], context)[0];
    const rendered = JSON.stringify(preview?.message);

    expect(rendered).toContain("Approve");
    expect(rendered).toContain('"disabled":true');
    expect(rendered).toContain(`"type":${ComponentType.Button}`);
  });
});
