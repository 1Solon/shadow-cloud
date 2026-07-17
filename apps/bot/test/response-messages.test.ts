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
  it("renders command failures with guidance and a reason detail", () => {
    const renderedMessage = rendered(
      buildCommandErrorReply("register", { message: "The game is full." }),
    );

    expect(renderedMessage).toContain("Registration failed");
    expect(renderedMessage).toContain(
      "Shadow Cloud could not complete /register.",
    );
    expect(renderedMessage).toContain("**Reason** The game is full.");
  });

  it("gives every response a specific headline and primary sentence", () => {
    const gameLink = rendered(
      buildGameLinkReply("https://shadow.example/games/42"),
    );
    const wrongChannel = rendered(
      buildWrongChannelReply("register", "GuildText", "channel-1"),
    );

    expect(gameLink).toContain("Open this game in Shadow Cloud");
    expect(gameLink).toContain(
      "[View the game](https://shadow.example/games/42) for status, roster, and uploads.",
    );
    expect(gameLink).not.toContain("<https://shadow.example/games/42>");
    expect(wrongChannel).toContain("Use this command in a game thread");
    expect(wrongChannel).toContain("**Channel type** GuildText");
    expect(wrongChannel).toContain("**Channel ID** channel-1");
  });

  it("leads turn advancement with the next player", () => {
    const message = buildTurnAdvancedAnnouncement({
      gameName: "Debug World",
      skippedName: "Previous Player",
      skippedSeat: 1,
      nextName: "Next Player",
      nextDiscordId: "user-2",
      nextSeat: 2,
    });
    const renderedMessage = rendered(message);

    expect(renderedMessage).toContain("It is now <@user-2>'s turn!");
    expect(renderedMessage).toContain(
      "**Previous Player** (seat 1) was skipped in **Debug World**.",
    );
    expect(renderedMessage).toContain("**Seat** 2");
    expect(message.allowedMentions).toEqual({ users: ["user-2"] });
  });

  it("renders approval failures without losing the API reason", () => {
    const renderedMessage = rendered(
      buildApprovalFailureReply("approve", "The request expired."),
    );

    expect(renderedMessage).toContain("Approval failed");
    expect(renderedMessage).toContain(
      "Shadow Cloud could not approve this registration.",
    );
    expect(renderedMessage).toContain("**Reason** The request expired.");
  });

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
      "You resigned from",
    );
    expect(
      buildResignationAnnouncement("user-1", "Debug World", 2, true)
        .allowedMentions,
    ).toEqual({ users: ["user-1"] });
    expect(
      rendered(buildSeatFilledReply("Debug World", "Player", 2)),
    ).toContain("now occupies seat 2");
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
    ).toContain(
      "[View the game](https://shadow.example/games/42) for status, roster, and uploads.",
    );
    expect(rendered(buildRegistrationSubmittedReply("Debug World"))).toContain(
      "Registration submitted",
    );
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
    expect(rendered(buildApprovalFailureReply("reject", "Rejected"))).toContain(
      "Rejection failed",
    );
  });
});
