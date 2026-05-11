const DISCORD_MESSAGE_ID_PATTERN = /^\d{17,20}$/;
const DISCORD_MESSAGE_URL_PATTERN =
  /^https:\/\/(?:discord|discordapp)\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})(?:\?.*)?$/;

export type ThreadMessageTargetContext = {
  guildId: string | null;
  channelId: string;
};

export type ThreadMessageTargetResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "invalid" | "wrong-guild" | "wrong-channel" };

export function parseThreadMessageTarget(
  input: string,
  context: ThreadMessageTargetContext,
): ThreadMessageTargetResult {
  const value = input.trim();

  if (DISCORD_MESSAGE_ID_PATTERN.test(value)) {
    return { ok: true, messageId: value };
  }

  const match = DISCORD_MESSAGE_URL_PATTERN.exec(value);

  if (!match) {
    return { ok: false, reason: "invalid" };
  }

  const [, guildId, channelId, messageId] = match;

  if (context.guildId && guildId !== context.guildId) {
    return { ok: false, reason: "wrong-guild" };
  }

  if (channelId !== context.channelId) {
    return { ok: false, reason: "wrong-channel" };
  }

  return { ok: true, messageId };
}
