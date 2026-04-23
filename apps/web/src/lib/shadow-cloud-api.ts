import { cache } from "react";

const apiBaseUrl = process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";
const transientApiRetryDelayMs = 250;
const transientApiRetryCount = 4;

type ApiErrorPayload = {
  message?: string | string[];
  error?: string;
};

export type GameListItem = {
  id: string;
  slug: string;
  gameNumber: number;
  name: string;
  organizerDisplayName: string;
  updatedAt: string;
  roundNumber: number;
  activePlayerDisplayName: string;
  playerCount: number;
  filledSeatCount: number;
};

export type GameDetail = {
  id: string;
  gameNumber: number;
  slug: string;
  name: string;
  organizerId: string;
  organizerDisplayName: string;
  playerCount: number | null;
  hasAiPlayers: boolean | null;
  dlcMode: string | null;
  gameMode: string | null;
  techLevel: number | null;
  zoneCount: string | null;
  armyCount: string | null;
  notes: string | null;
  roundNumber: number;
  activePlayerEntryId: string | null;
  activePlayerUserId: string | null;
  activePlayerDisplayName: string;
  players: Array<{
    id: string;
    userId: string | null;
    displayName: string | null;
    turnOrder: number;
    isOrganizer: boolean;
  }>;
  fileVersions: Array<{
    id: string;
    originalName: string;
    uploadedAt: string;
    uploadedByDisplayName: string;
  }>;
};

class ApiResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function getApiErrorMessage(payload: ApiErrorPayload | null, fallback: string) {
  if (Array.isArray(payload?.message)) {
    return payload.message.join(", ");
  }

  return payload?.message ?? payload?.error ?? fallback;
}

function isTransientFetchFailure(error: unknown) {
  if (!(error instanceof TypeError)) {
    return false;
  }

  const cause = (
    error as TypeError & {
      cause?: { code?: string; errors?: Array<{ code?: string }> };
    }
  ).cause;

  if (cause?.code === "ECONNREFUSED" || cause?.code === "ECONNRESET") {
    return true;
  }

  return (
    cause?.errors?.some(
      (nestedError) =>
        nestedError.code === "ECONNREFUSED" ||
        nestedError.code === "ECONNRESET",
    ) ?? false
  );
}

function delay(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function fetchShadowCloudApi<T>(path: string, fallbackMessage: string) {
  let response: Response | null = null;

  for (let attempt = 0; attempt <= transientApiRetryCount; attempt += 1) {
    try {
      response = await fetch(`${apiBaseUrl}${path}`, {
        cache: "no-store",
      });
      break;
    } catch (error) {
      if (
        attempt === transientApiRetryCount ||
        !isTransientFetchFailure(error)
      ) {
        throw error;
      }

      await delay(transientApiRetryDelayMs * (attempt + 1));
    }
  }

  if (!response) {
    throw new Error(fallbackMessage);
  }

  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as ApiErrorPayload | null;
    throw new ApiResponseError(
      getApiErrorMessage(payload, fallbackMessage),
      response.status || 500,
    );
  }

  return response.json() as Promise<T>;
}

export const listGames = cache(() =>
  fetchShadowCloudApi<GameListItem[]>("/v1/games", "Failed to load games."),
);

export const getGameDetail = cache(async (gameIdentifier: string) => {
  try {
    return await fetchShadowCloudApi<GameDetail>(
      `/v1/games/${encodeURIComponent(gameIdentifier)}/detail`,
      "Failed to load the game.",
    );
  } catch (error) {
    if (error instanceof ApiResponseError && error.status === 404) {
      return null;
    }

    throw error;
  }
});
