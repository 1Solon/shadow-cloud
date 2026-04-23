import type { Client } from "discord.js";
import type { BotApiConfig } from "./bot-api.js";
import { renameThreadIfNeeded } from "./thread-name.js";

type StartupThreadRecord = {
  id: string;
  name: string;
  threadName: string;
  discordThreadId: string | null;
};

async function fetchStartupThreads(config: BotApiConfig) {
  const response = await fetch(`${config.apiBaseUrl}/v1/games`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Games list request failed with ${response.status}.`);
  }

  return (await response.json().catch(() => [])) as StartupThreadRecord[];
}

export async function syncStartupThreadNames(
  client: Client,
  config: BotApiConfig,
) {
  let games: StartupThreadRecord[];

  try {
    games = await fetchStartupThreads(config);
  } catch (error) {
    console.warn(
      `Skipping startup thread sync because ${config.apiBaseUrl}/v1/games is unavailable.`,
      error,
    );
    return;
  }

  const linkedGames = games.filter(
    (game) =>
      typeof game.discordThreadId === "string" &&
      game.discordThreadId.length > 0 &&
      typeof game.threadName === "string" &&
      game.threadName.trim().length > 0,
  );

  let renamedCount = 0;
  let unchangedCount = 0;

  for (const game of linkedGames) {
    const threadId = game.discordThreadId;

    try {
      if (!threadId) {
        continue;
      }

      const channel = await client.channels.fetch(threadId);

      if (!channel || !channel.isThread()) {
        console.warn(
          `Skipping startup rename for ${game.name}: channel ${threadId} is not a thread.`,
        );
        continue;
      }

      if (channel.joinable) {
        await channel.join().catch(() => undefined);
      }

      const renamed = await renameThreadIfNeeded(channel, game.threadName);

      if (renamed) {
        renamedCount += 1;
      } else {
        unchangedCount += 1;
      }
    } catch (error) {
      console.warn(
        `Failed startup rename sync for ${game.name} (${threadId}).`,
        error,
      );
    }
  }

  console.log(
    `Startup thread sync complete. Renamed ${renamedCount}, already synced ${unchangedCount}, scanned ${linkedGames.length}.`,
  );
}
