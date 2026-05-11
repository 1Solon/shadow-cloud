import { openUrl } from "@tauri-apps/plugin-opener";
import {
  defaultApiBaseUrl,
  defaultWebBaseUrl,
} from "@/api/shadowCloudApi";

const fallbackPollIntervalMs = 1_500;

type DesktopSignInDependencies = {
  apiBaseUrl: string;
  fetch: typeof fetch;
  openWebHandoff: (url: string) => Promise<unknown>;
  waitForPollInterval?: (delayMs: number) => Promise<void>;
  webBaseUrl: string;
};

type DesktopSignInOptions = {
  apiBaseUrl?: string;
  webBaseUrl?: string;
};

type DesktopHandoff = {
  handoffId: string;
  pollSecret: string;
  expiresAt: string;
  pollIntervalMs: number;
};

type DesktopHandoffPollResult =
  | {
      status: "pending";
      expiresAt: string;
    }
  | {
      status: "approved";
      token: string;
    }
  | {
      status: "expired";
    };

type ApiErrorPayload = {
  error?: unknown;
  message?: unknown;
};

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/g, "");
}

function waitForPollInterval(delayMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

function getApiErrorMessage(payload: unknown, fallbackMessage: string) {
  if (!payload || typeof payload !== "object") {
    return fallbackMessage;
  }

  const { error, message } = payload as ApiErrorPayload;

  if (Array.isArray(message)) {
    const messages = message.filter((entry): entry is string => (
      typeof entry === "string"
    ));

    return messages.length > 0 ? messages.join(", ") : fallbackMessage;
  }

  if (typeof message === "string") {
    return message;
  }

  if (typeof error === "string") {
    return error;
  }

  return fallbackMessage;
}

async function readJsonResponse<T>(
  response: Response,
  fallbackMessage: string,
) {
  const payload = await response.json().catch(() => null) as unknown;

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, fallbackMessage));
  }

  return payload as T;
}

async function createDesktopHandoff({
  apiBaseUrl,
  fetch,
}: Pick<DesktopSignInDependencies, "apiBaseUrl" | "fetch">) {
  const response = await fetch(
    `${normalizeBaseUrl(apiBaseUrl)}/v1/auth/desktop-handoffs`,
    {
      method: "POST",
      cache: "no-store",
    },
  );

  return readJsonResponse<DesktopHandoff>(
    response,
    "Could not start desktop sign-in.",
  );
}

async function pollDesktopHandoff(
  {
    apiBaseUrl,
    fetch,
  }: Pick<DesktopSignInDependencies, "apiBaseUrl" | "fetch">,
  handoff: Pick<DesktopHandoff, "handoffId" | "pollSecret">,
) {
  const response = await fetch(
    `${normalizeBaseUrl(apiBaseUrl)}/v1/auth/desktop-handoffs/${encodeURIComponent(handoff.handoffId)}/poll`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ pollSecret: handoff.pollSecret }),
      cache: "no-store",
    },
  );

  return readJsonResponse<DesktopHandoffPollResult>(
    response,
    "Could not complete desktop sign-in.",
  );
}

function getDesktopHandoffUrl(webBaseUrl: string, handoffId: string) {
  return `${normalizeBaseUrl(webBaseUrl)}/api/auth/desktop?handoff=${encodeURIComponent(handoffId)}`;
}

function hasExpired(expiresAt: string) {
  return Date.now() >= new Date(expiresAt).getTime();
}

export function createDesktopSignIn(dependencies: DesktopSignInDependencies) {
  return async () => {
    const handoff = await createDesktopHandoff(dependencies);

    await dependencies.openWebHandoff(
      getDesktopHandoffUrl(dependencies.webBaseUrl, handoff.handoffId),
    );

    while (!hasExpired(handoff.expiresAt)) {
      const result = await pollDesktopHandoff(dependencies, handoff);

      if (result.status === "approved") {
        return result.token;
      }

      if (result.status === "expired") {
        break;
      }

      await (
        dependencies.waitForPollInterval ?? waitForPollInterval
      )(handoff.pollIntervalMs ?? fallbackPollIntervalMs);
    }

    throw new Error("Desktop sign-in expired.");
  };
}

export async function startDesktopSignIn(options: DesktopSignInOptions = {}) {
  return createDesktopSignIn({
    apiBaseUrl: options.apiBaseUrl ?? defaultApiBaseUrl,
    fetch,
    openWebHandoff: openUrl,
    webBaseUrl: options.webBaseUrl ?? defaultWebBaseUrl,
  })();
}
