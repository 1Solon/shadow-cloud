import type { AnyThreadChannel, Snowflake } from "discord.js";

const MAX_FORUM_TAGS = 5;
const THREAD_RENAME_TIMEOUT_MS = 15_000;
export const SHADOW_CLOUD_TAG_NAME = "Shadow Cloud";

export type ShadowCloudTagSyncResult =
  | { status: "applied"; tagId: Snowflake }
  | { status: "unchanged"; tagId: Snowflake }
  | { status: "max-tags"; tagId: Snowflake; appliedTagCount: number }
  | { status: "unsupported" }
  | { status: "missing-tag" };

type AvailableTag = {
  id: Snowflake;
  name: string;
};

type TaggableThread = AnyThreadChannel & {
  appliedTags: Snowflake[];
  parent: {
    availableTags?: AvailableTag[];
  } | null;
  setAppliedTags(tags: readonly Snowflake[]): Promise<unknown>;
};

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

function isTaggableThread(thread: AnyThreadChannel): thread is TaggableThread {
  return (
    Array.isArray((thread as { appliedTags?: unknown }).appliedTags) &&
    typeof (thread as { setAppliedTags?: unknown }).setAppliedTags ===
      "function"
  );
}

function findShadowCloudTag(thread: TaggableThread) {
  const availableTags = Array.isArray(thread.parent?.availableTags)
    ? thread.parent.availableTags
    : [];

  return (
    availableTags.find((tag) => tag.name === SHADOW_CLOUD_TAG_NAME) ?? null
  );
}

async function resolveThread(thread: AnyThreadChannel) {
  return withTimeout(
    Promise.resolve(thread.fetch()),
    THREAD_RENAME_TIMEOUT_MS,
    `Fetching thread ${thread.id}`,
  );
}

export async function renameThreadIfNeeded(
  thread: AnyThreadChannel,
  nextName: string,
) {
  const normalizedName = nextName.trim();
  const resolvedThread = await resolveThread(thread);

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

export async function ensureShadowCloudTag(
  thread: AnyThreadChannel,
): Promise<ShadowCloudTagSyncResult> {
  const resolvedThread = await resolveThread(thread);

  if (!isTaggableThread(resolvedThread)) {
    return { status: "unsupported" };
  }

  const shadowCloudTag = findShadowCloudTag(resolvedThread);

  if (!shadowCloudTag) {
    return { status: "missing-tag" };
  }

  if (resolvedThread.appliedTags.includes(shadowCloudTag.id)) {
    return { status: "unchanged", tagId: shadowCloudTag.id };
  }

  if (resolvedThread.appliedTags.length >= MAX_FORUM_TAGS) {
    return {
      status: "max-tags",
      tagId: shadowCloudTag.id,
      appliedTagCount: resolvedThread.appliedTags.length,
    };
  }

  await withTimeout(
    Promise.resolve(
      resolvedThread.setAppliedTags([
        ...resolvedThread.appliedTags,
        shadowCloudTag.id,
      ]),
    ),
    THREAD_RENAME_TIMEOUT_MS,
    `Applying Shadow Cloud tag to thread ${thread.id}`,
  );

  return { status: "applied", tagId: shadowCloudTag.id };
}
