import { SlashCommandBuilder } from "discord.js";

const dlcChoices = [
  { name: "None", value: "NONE" },
  { name: "Oceania", value: "OCEANIA" },
  { name: "Republica", value: "REPUBLICA" },
  { name: "Both", value: "BOTH" },
] as const;

const gameModeChoices = [
  { name: "Teams", value: "TEAMS" },
  { name: "Teams+AI", value: "TEAMS_AI" },
  { name: "FFA", value: "FFA" },
  { name: "FFA+AI", value: "FFA_AI" },
] as const;

const techLevelChoices = [
  { name: "3", value: 3 },
  { name: "4", value: 4 },
  { name: "5", value: 5 },
] as const;

const zoneCountChoices = [
  { name: "City State", value: "CITY_STATE" },
  { name: "2 Zone Start", value: "TWO_ZONE_START" },
  { name: "3 Zone Start", value: "THREE_ZONE_START" },
] as const;

const armyCountChoices = [
  { name: "Militia Only", value: "MILITIA_ONLY" },
  { name: "1 Army per Zone", value: "ONE_PER_ZONE" },
  { name: "2 Armies per Zone", value: "TWO_PER_ZONE" },
] as const;

const initCommand = new SlashCommandBuilder()
  .setName("init")
  .setDescription(
    "Create a Shadow Cloud game record for the current forum thread.",
  )
  .addStringOption((option) =>
    option
      .setName("title")
      .setDescription("Game title.")
      .setRequired(true)
      .setMaxLength(100),
  )
  .addIntegerOption((option) =>
    option
      .setName("number")
      .setDescription("Game number.")
      .setRequired(true)
      .setMinValue(1),
  )
  .addIntegerOption((option) =>
    option
      .setName("player_count")
      .setDescription("Total seat limit for this game.")
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(100),
  )
  .addBooleanOption((option) =>
    option
      .setName("ai_players")
      .setDescription("Whether AI players are included.")
      .setRequired(false),
  )
  .addStringOption((option) =>
    option
      .setName("dlc")
      .setDescription("Included DLCs.")
      .setRequired(false)
      .addChoices(...dlcChoices),
  )
  .addStringOption((option) =>
    option
      .setName("gamemode")
      .setDescription("Game mode.")
      .setRequired(false)
      .addChoices(...gameModeChoices),
  )
  .addIntegerOption((option) =>
    option
      .setName("tech_level")
      .setDescription("Tech level.")
      .setRequired(false)
      .addChoices(...techLevelChoices),
  )
  .addStringOption((option) =>
    option
      .setName("zone_count")
      .setDescription("Zone count preset.")
      .setRequired(false)
      .addChoices(...zoneCountChoices),
  )
  .addStringOption((option) =>
    option
      .setName("army_count")
      .setDescription("Army count preset.")
      .setRequired(false)
      .addChoices(...armyCountChoices),
  );

const registerCommand = new SlashCommandBuilder()
  .setName("register")
  .setDescription(
    "Register yourself as the next player in the current Shadow Cloud game thread.",
  );

const resignCommand = new SlashCommandBuilder()
  .setName("resign")
  .setDescription("Remove yourself from the current Shadow Cloud game thread.");

const replaceCommand = new SlashCommandBuilder()
  .setName("replace")
  .setDescription("Fill an empty seat with a new player (overlord only).")
  .addIntegerOption((option) =>
    option
      .setName("seat")
      .setDescription("The seat number to fill.")
      .setMinValue(1)
      .setRequired(true),
  )
  .addUserOption((option) =>
    option
      .setName("player")
      .setDescription("The Discord user to place in the seat.")
      .setRequired(true),
  );

const skipCommand = new SlashCommandBuilder()
  .setName("skip")
  .setDescription("Skip the current active player's turn (overlord only).");

const linkCommand = new SlashCommandBuilder()
  .setName("link")
  .setDescription(
    "Post the Shadow Cloud game link for the current forum thread.",
  );

export const supportedCommandNames = [
  "init",
  "register",
  "resign",
  "replace",
  "skip",
  "link",
] as const;

export type SupportedCommandName = (typeof supportedCommandNames)[number];

const supportedCommandNameSet = new Set<string>(supportedCommandNames);

export function isSupportedCommandName(
  commandName: string,
): commandName is SupportedCommandName {
  return supportedCommandNameSet.has(commandName);
}

export const slashCommands = [
  initCommand,
  registerCommand,
  resignCommand,
  replaceCommand,
  skipCommand,
  linkCommand,
] as const;
