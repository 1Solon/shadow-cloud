import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = dirname(currentFilePath);

loadEnv({ path: resolve(currentDirectory, "../../../.env") });

export const botConfig = {
  token: process.env.DISCORD_BOT_TOKEN,
  apiBaseUrl: process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001",
  webBaseUrl: process.env.AUTH_URL ?? "http://localhost:3000",
  botApiToken: process.env.BOT_API_TOKEN,
  notificationSecret: process.env.SHADOW_CLOUD_BOT_NOTIFY_SECRET,
  notificationPort: 3011,
};