import { createServer } from "node:http";
import type { Client } from "discord.js";
import {
  buildGameInitNotificationMessage,
  buildSaveNotificationMessage,
  type GameInitializedNotificationPayload,
  type ThreadRenameNotificationPayload,
  type UploadNotificationPayload,
} from "./notifications.js";
import { renameThreadIfNeeded } from "./thread-name.js";

type NotificationServerConfig = {
  notificationPort: number;
  notificationSecret?: string;
  webBaseUrl: string;
};

async function resolveNotificationThread(client: Client, threadId: string) {
  const channel = await client.channels.fetch(threadId);

  if (!channel || !channel.isThread()) {
    throw new Error(`Channel ${threadId} is not a thread.`);
  }

  if (channel.joinable) {
    await channel.join().catch(() => undefined);
  }

  return channel;
}

export function startNotificationServer(
  client: Client,
  {
    notificationPort,
    notificationSecret,
    webBaseUrl,
  }: NotificationServerConfig,
) {
  if (!notificationSecret) {
    console.warn(
      "SHADOW_CLOUD_BOT_NOTIFY_SECRET is not set. Bot notifications are disabled.",
    );
    return;
  }

  const server = createServer(async (request, response) => {
    const isSaveUploadedRequest = request.url === "/notify/save-uploaded";
    const isGameInitializedRequest = request.url === "/notify/game-initialized";
    const isThreadRenameRequest = request.url === "/notify/thread-rename";

    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200).end("ok");
      return;
    }

    if (
      request.method !== "POST" ||
      (!isSaveUploadedRequest &&
        !isGameInitializedRequest &&
        !isThreadRenameRequest)
    ) {
      response.writeHead(404).end("Not found");
      return;
    }

    if (
      request.headers["x-shadow-cloud-notify-secret"] !== notificationSecret
    ) {
      response.writeHead(401).end("Unauthorized");
      return;
    }

    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }

    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as
        | UploadNotificationPayload
        | GameInitializedNotificationPayload
        | ThreadRenameNotificationPayload;

      if (!payload.game.discordThreadId) {
        response.writeHead(202).end("No thread configured");
        return;
      }

      const thread = await resolveNotificationThread(
        client,
        payload.game.discordThreadId,
      );

      if (isGameInitializedRequest) {
        await renameThreadIfNeeded(
          thread,
          (payload as GameInitializedNotificationPayload).game.threadName,
        );
      }

      if (isThreadRenameRequest) {
        await renameThreadIfNeeded(
          thread,
          (payload as ThreadRenameNotificationPayload).game.threadName,
        );
        response.writeHead(204).end();
        return;
      }

      await thread.send(
        isSaveUploadedRequest
          ? buildSaveNotificationMessage(
              payload as UploadNotificationPayload,
              webBaseUrl,
            )
          : buildGameInitNotificationMessage(
              payload as GameInitializedNotificationPayload,
              webBaseUrl,
            ),
      );

      response.writeHead(204).end();
    } catch (error) {
      console.error("Failed to process bot notification.", error);
      response.writeHead(500).end("Failed to post notification");
    }
  });

  server.on("error", (error) => {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.warn(
        `Notification server port ${notificationPort} is already in use. Reusing the existing listener.`,
      );
      return;
    }

    throw error;
  });

  server.listen(notificationPort, () => {
    console.log(
      `Shadow Cloud notification server listening on ${notificationPort}`,
    );
  });
}
