import { describe, expect, it } from "vitest";
import {
  buildApprovalFailureReply,
  buildBotMisconfiguredReply,
  buildCommandErrorReply,
  buildDiscordPinFailureReply,
  buildGameLinkReply,
  buildInvalidMessageTargetReply,
  buildMessagePinReply,
  buildRegistrationSubmittedReply,
  buildResignationAnnouncement,
  buildResignationCompleteReply,
  buildSeatFilledAnnouncement,
  buildSeatFilledReply,
  buildShadowCloudUnavailableReply,
  buildTurnAdvancedAnnouncement,
  buildTurnSkippedReply,
  buildWrongChannelReply,
} from "../src/response-messages.js";

const rendered = (value: unknown) => JSON.stringify(value);

describe("response message builders", () => {
  it("builds command errors with command-specific titles and fallback text", () => {
    expect(rendered(buildCommandErrorReply("init", null))).toContain(
      "Initialization failed",
    );
    expect(rendered(buildCommandErrorReply("unpin", null))).toContain(
      "The API rejected the unpin request.",
    );
  });

  it("builds reusable validation and availability responses", () => {
    expect(
      rendered(buildWrongChannelReply("register", "0", "channel-1")),
    ).toContain("Run /register inside the forum thread");
    expect(rendered(buildBotMisconfiguredReply())).toContain("BOT_API_TOKEN");
    expect(rendered(buildInvalidMessageTargetReply())).toContain(
      "message ID or message link",
    );
    expect(rendered(buildShadowCloudUnavailableReply())).toContain(
      "Unable to reach the Shadow Cloud API",
    );
  });

  it("builds successful command replies and announcements", () => {
    expect(rendered(buildResignationCompleteReply("Debug World"))).toContain(
      "successfully resigned",
    );
    expect(
      buildResignationAnnouncement("user-1", "Debug World", 2, true)
        .allowedMentions,
    ).toEqual({ users: ["user-1"] });
    expect(
      rendered(buildSeatFilledReply("Debug World", "Player", 2)),
    ).toContain("Seat 2 has been filled");
    expect(
      buildSeatFilledAnnouncement("user-1", "Debug World", 2, true)
        .allowedMentions,
    ).toEqual({ users: ["user-1"] });
    expect(
      rendered(buildTurnSkippedReply("Debug World", "Player", 2)),
    ).toContain("Turn skipped");
    expect(
      buildTurnAdvancedAnnouncement({
        gameName: "Debug World",
        skippedName: "Player",
        skippedSeat: 2,
        nextName: "Next",
        nextDiscordId: "user-1",
        nextSeat: 3,
      }).allowedMentions,
    ).toEqual({ users: ["user-1"] });
    expect(
      rendered(buildGameLinkReply("https://shadow.example/games/42")),
    ).toContain("<https://shadow.example/games/42>");
    expect(
      rendered(buildRegistrationSubmittedReply("Debug World")),
    ).toContain("Registration submitted");
  });

  it("distinguishes pinning and approval outcomes", () => {
    expect(rendered(buildMessagePinReply("pin", "message-1"))).toContain(
      "Message pinned",
    );
    expect(rendered(buildMessagePinReply("unpin", "message-1"))).toContain(
      "Message unpinned",
    );
    expect(rendered(buildDiscordPinFailureReply("pin"))).toContain(
      "manage pinned",
    );
    expect(
      rendered(buildApprovalFailureReply("approve", "Rejected")),
    ).toContain("Approval failed");
    expect(
      rendered(buildApprovalFailureReply("reject", "Rejected")),
    ).toContain("Rejection failed");
  });
});
