import { ComponentType, MessageFlags } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDebugPreviews,
  debugPreviewNames,
  selectDebugPreviewNames,
} from "../src/debug-previews.js";
import { ACCENT_COLOR } from "../src/notifications.js";

const context = {
  userId: "user-1",
  userDisplayName: "Debug User",
  webBaseUrl: "https://shadow.example",
};

afterEach(() => {
  vi.useRealTimers();
});

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));

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
      const serialized = JSON.parse(JSON.stringify(preview.message)) as {
        components: Array<{
          accent_color: number;
          components: Array<{ type: number; content?: string }>;
        }>;
      };
      const [container] = serialized.components;
      const componentTypes =
        container?.components.map(({ type }) => type) ?? [];
      const timestamp = container?.components.find(({ content }) =>
        content?.includes("<t:"),
      );

      expect(container?.accent_color).toBe(ACCENT_COLOR);
      expect(container?.components[0]?.type).toBe(ComponentType.TextDisplay);
      expect(container?.components[1]?.type).toBe(ComponentType.TextDisplay);
      expect(componentTypes).toContain(ComponentType.Separator);
      expect(timestamp?.content).toMatch(/^-# <t:\d+:F>$/);
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
