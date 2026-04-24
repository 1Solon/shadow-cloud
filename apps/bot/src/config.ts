import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = dirname(currentFilePath);

loadEnv({ path: resolve(currentDirectory, "../../../.env") });

function normalizeBaseUrl(value: string | undefined, fallback: string) {
  const candidate = value?.trim();

  if (!candidate) {
    return fallback;
  }

  try {
    return new URL(candidate).toString();
  } catch {
    try {
      return new URL(`http://${candidate}`).toString();
    } catch {
      return fallback;
    }
  }
}

export const botConfig = {
  token: process.env.DISCORD_BOT_TOKEN,
  apiBaseUrl: process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001",
  webBaseUrl: normalizeBaseUrl(
    process.env.AUTH_URL,
    "http://localhost:3000",
  ),
  botApiToken: process.env.BOT_API_TOKEN,
  notificationSecret: process.env.SHADOW_CLOUD_BOT_NOTIFY_SECRET,
  notificationPort: 3011,
};
