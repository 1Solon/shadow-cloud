import { ApplicationCommandOptionType } from "discord.js";
import { describe, expect, it } from "vitest";
import {
  isSupportedCommandName,
  slashCommands,
  supportedCommandNames,
} from "../src/commands";

describe("commands", () => {
  it("recognizes every exported supported command name", () => {
    expect(supportedCommandNames.every(isSupportedCommandName)).toBe(true);
  });

  it("rejects unsupported command names", () => {
    expect(isSupportedCommandName("unknown")).toBe(false);
  });

  it("keeps slash command definitions aligned with supported command names", () => {
    expect(slashCommands.map((command) => command.name)).toEqual(
      supportedCommandNames,
    );
  });

  it("includes host-only pinning commands after link", () => {
    expect(supportedCommandNames).toEqual([
      "init",
      "register",
      "resign",
      "replace",
      "skip",
      "link",
      "pin",
      "unpin",
      "debug",
    ]);
  });

  it("registers a guild-only debug command with an optional notification list", () => {
    const debugCommand = slashCommands
      .find((command) => command.name === "debug")
      ?.toJSON();

    expect(debugCommand).toMatchObject({
      name: "debug",
      dm_permission: false,
      options: [
        {
          name: "notifications",
          type: ApplicationCommandOptionType.String,
          required: false,
          max_length: 1_000,
        },
      ],
    });
  });

  it("exposes bounded whole-hour turn timing options on init", () => {
    const initCommand = slashCommands.find(
      (command) => command.name === "init",
    );
    const optionsByName = new Map(
      (initCommand?.toJSON().options ?? []).map((option) => [
        option.name,
        option,
      ]),
    );

    for (const name of [
      "turn_target_hours",
      "turn_reminder_grace_hours",
      "turn_reminder_repeat_hours",
    ]) {
      expect(optionsByName.get(name)).toMatchObject({
        type: ApplicationCommandOptionType.Integer,
        required: false,
        min_value: 1,
        max_value: 1_000_000_000,
      });
    }
  });

  it("describes replace as filling or replacing a campaign seat", () => {
    const replaceCommand = slashCommands.find(
      (command) => command.name === "replace",
    );

    expect(replaceCommand?.description).toBe(
      "Replace or fill a campaign seat (overlord only).",
    );
  });
});
