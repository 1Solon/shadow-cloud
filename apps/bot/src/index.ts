import { Client, Events, GatewayIntentBits } from "discord.js";
import { botConfig } from "./config.js";
import { slashCommands } from "./commands.js";
import { createInteractionHandler } from "./interaction-handler.js";
import { startNotificationServer } from "./notification-server.js";
import { syncStartupThreadNames } from "./startup-thread-sync.js";

const token = botConfig.token;

if (!token) {
  console.warn(
    "DISCORD_BOT_TOKEN is not set. The bot will not start until the environment is configured.",
  );
  process.exit(0);
}

if (!botConfig.botApiToken) {
  console.warn(
    "BOT_API_TOKEN is not set. The bot cannot create games until the environment is configured.",
  );
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Shadow Cloud bot ready as ${readyClient.user.tag}`);

  await readyClient.application.commands.set(
    slashCommands.map((command) => command.toJSON()),
  );
  console.log("Registered Shadow Cloud slash commands.");

  await syncStartupThreadNames(client, {
    apiBaseUrl: botConfig.apiBaseUrl,
    botApiToken: botConfig.botApiToken,
  });

  startNotificationServer(client, {
    notificationPort: botConfig.notificationPort,
    notificationSecret: botConfig.notificationSecret,
    webBaseUrl: botConfig.webBaseUrl,
  });
});

client.on(
  Events.InteractionCreate,
  createInteractionHandler(client, {
    apiBaseUrl: botConfig.apiBaseUrl,
    webBaseUrl: botConfig.webBaseUrl,
    botApiToken: botConfig.botApiToken,
  }),
);

void client.login(token);
