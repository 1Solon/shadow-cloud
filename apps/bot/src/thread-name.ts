import type { AnyThreadChannel } from "discord.js";

const THREAD_RENAME_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    void promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

export async function renameThreadIfNeeded(
  thread: AnyThreadChannel,
  nextName: string,
) {
  const normalizedName = nextName.trim();
  const resolvedThread = await withTimeout(
    Promise.resolve(thread.fetch()),
    THREAD_RENAME_TIMEOUT_MS,
    `Fetching thread ${thread.id}`,
  );

  if (!normalizedName || resolvedThread.name === normalizedName) {
    return false;
  }

  await withTimeout(
    Promise.resolve(
      resolvedThread.edit({
        name: normalizedName,
        ...(resolvedThread.archived ? { archived: false } : {}),
      }),
    ),
    THREAD_RENAME_TIMEOUT_MS,
    `Renaming thread ${thread.id}`,
  );

  return true;
}
