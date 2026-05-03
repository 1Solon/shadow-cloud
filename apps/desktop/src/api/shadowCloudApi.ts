import type { GameDetail, GameListItem } from '@/sync/sync-engine';
import type { LocalSaveFile } from '@/sync/sync-files';

export const defaultApiBaseUrl =
  import.meta.env.VITE_SHADOW_CLOUD_API_URL ??
  'https://shadow-cloud.solonsstuff.com/';
export const defaultWebBaseUrl =
  import.meta.env.VITE_SHADOW_CLOUD_WEB_URL ??
  'https://shadow-cloud.solonsstuff.com/';
export const webBaseUrl = defaultWebBaseUrl;

type ShadowCloudApiClientOptions = {
  apiBaseUrl?: string;
};

type UploadResponse = {
  fileVersionId: string;
  originalName: string;
};

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/g, '');
}

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

function getApiUnavailableError(apiBaseUrl: string) {
  return new Error(`Could not reach Shadow-Cloud API at ${apiBaseUrl}.`);
}

function parseContentDispositionFileName(header: string | null) {
  const match = header?.match(/filename="([^"]+)"/i);

  if (!match) {
    return null;
  }

  return decodeURIComponent(match[1]);
}

function createFetchJson(apiBaseUrl: string) {
  return async function fetchJson<T>(
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
      throw getApiUnavailableError(apiBaseUrl);
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(getApiErrorMessage(payload, fallbackMessage));
    }

    return response.json() as Promise<T>;
  };
}

export function createShadowCloudApiClient(
  options: ShadowCloudApiClientOptions = {},
) {
  const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl ?? defaultApiBaseUrl);
  const fetchJson = createFetchJson(apiBaseUrl);

  return {
    listGames(token: string) {
      return fetchJson<GameListItem[]>('/v1/games', token, 'Failed to load games.');
    },

    getGameDetail(token: string, gameNumber: number) {
      return fetchJson<GameDetail>(
        `/v1/games/${encodeURIComponent(gameNumber)}/detail`,
        token,
        'Failed to load campaign detail.',
      );
    },

    async uploadSave(token: string, gameNumber: number, file: LocalSaveFile) {
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
    },

    async downloadFile(
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
        throw getApiUnavailableError(apiBaseUrl);
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(getApiErrorMessage(payload, 'The save download failed.'));
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      const fileName =
        parseContentDispositionFileName(
          response.headers.get('content-disposition'),
        ) ?? `${fileVersionId}.se1`;

      return {
        bytes,
        fileName,
      };
    },
  };
}

const defaultClient = createShadowCloudApiClient();

export const listGames = defaultClient.listGames;
export const getGameDetail = defaultClient.getGameDetail;
export const uploadSave = defaultClient.uploadSave;
export const downloadFile = defaultClient.downloadFile;
