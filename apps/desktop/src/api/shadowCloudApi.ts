import type { GameDetail, GameListItem } from '@/sync/sync-engine';
import type { LocalSaveFile } from '@/sync/sync-files';

const apiBaseUrl =
  import.meta.env.VITE_SHADOW_CLOUD_API_URL ?? 'http://localhost:3001';
export const webBaseUrl =
  import.meta.env.VITE_SHADOW_CLOUD_WEB_URL ?? 'http://localhost:3000';

type UploadResponse = {
  fileVersionId: string;
  originalName: string;
};

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function getApiErrorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === 'object' &&
    'message' in payload &&
    Array.isArray(payload.message)
  ) {
    return payload.message.join(', ');
  }

  if (
    payload &&
    typeof payload === 'object' &&
    'message' in payload &&
    typeof payload.message === 'string'
  ) {
    return payload.message;
  }

  if (
    payload &&
    typeof payload === 'object' &&
    'error' in payload &&
    typeof payload.error === 'string'
  ) {
    return payload.error;
  }

  return fallback;
}

function getApiUnavailableError() {
  return new Error(`Could not reach Shadow-Cloud API at ${apiBaseUrl}.`);
}

async function fetchJson<T>(
  path: string,
  token: string,
  fallbackMessage: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  }).catch(() => {
    throw getApiUnavailableError();
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, fallbackMessage));
  }

  return response.json() as Promise<T>;
}

export function listGames(token: string) {
  return fetchJson<GameListItem[]>(token ? '/v1/games' : '/v1/games', token, 'Failed to load games.');
}

export function getGameDetail(token: string, gameNumber: number) {
  return fetchJson<GameDetail>(
    `/v1/games/${encodeURIComponent(gameNumber)}/detail`,
    token,
    'Failed to load campaign detail.',
  );
}

export async function uploadSave(
  token: string,
  gameNumber: number,
  file: LocalSaveFile,
) {
  const formData = new FormData();
  formData.set(
    'file',
    new File([toArrayBuffer(file.bytes)], file.name, {
      type: 'application/octet-stream',
      lastModified: file.modifiedAt,
    }),
  );

  return fetchJson<UploadResponse>(
    `/v1/games/${encodeURIComponent(gameNumber)}/files`,
    token,
    'The save upload failed.',
    {
      method: 'POST',
      body: formData,
    },
  );
}

function parseContentDispositionFileName(header: string | null) {
  const match = header?.match(/filename="([^"]+)"/i);

  if (!match) {
    return null;
  }

  return decodeURIComponent(match[1]);
}

export async function downloadFile(
  token: string,
  gameNumber: number,
  fileVersionId: string,
) {
  const response = await fetch(
    `${apiBaseUrl}/v1/games/${encodeURIComponent(
      gameNumber,
    )}/files/${encodeURIComponent(fileVersionId)}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    },
  ).catch(() => {
    throw getApiUnavailableError();
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(getApiErrorMessage(payload, 'The save download failed.'));
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const fileName =
    parseContentDispositionFileName(response.headers.get('content-disposition')) ??
    `${fileVersionId}.se1`;

  return {
    bytes,
    fileName,
  };
}
