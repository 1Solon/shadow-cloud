import {
  getCurrent,
  isRegistered,
  onOpenUrl,
  register,
} from "@tauri-apps/plugin-deep-link";
import { openUrl } from "@tauri-apps/plugin-opener";
import { webBaseUrl } from "@/api/shadowCloudApi";

const protocol = "shadow-cloud";
const protocolRegistrationTimeoutMs = 1_500;

type DesktopSignInDependencies = {
  isRegistered: (protocol: string) => Promise<boolean>;
  openWebHandoff: (url: string) => Promise<unknown>;
  register: (protocol: string) => Promise<unknown>;
  webBaseUrl: string;
};

export function readTokenFromDeepLink(url: string) {
  try {
    const parsedUrl = new URL(url);

    if (
      parsedUrl.protocol !== `${protocol}:` ||
      parsedUrl.hostname !== "auth"
    ) {
      return null;
    }

    return parsedUrl.searchParams.get("token");
  } catch {
    return null;
  }
}

export async function startDesktopSignIn(nextWebBaseUrl = webBaseUrl) {
  await createDesktopSignIn({
    isRegistered,
    openWebHandoff: openUrl,
    register,
    webBaseUrl: nextWebBaseUrl,
  })();
}

async function ensureDesktopProtocolRegistered({
  isRegistered,
  register,
}: Pick<DesktopSignInDependencies, "isRegistered" | "register">) {
  if (await isRegistered(protocol)) {
    return;
  }

  try {
    await register(protocol);
  } catch (error) {
    if (await isRegistered(protocol)) {
      return;
    }

    throw error;
  }

  if (!(await isRegistered(protocol))) {
    throw new Error("Desktop protocol registration did not complete.");
  }
}

function createProtocolRegistrationTimeout() {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return {
    cancel() {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    },
    promise: new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(
        () => resolve("timeout"),
        protocolRegistrationTimeoutMs,
      );
    }),
  };
}

async function waitForDesktopProtocolRegistration(
  dependencies: Pick<DesktopSignInDependencies, "isRegistered" | "register">,
) {
  const registration = ensureDesktopProtocolRegistered(dependencies);
  const timeout = createProtocolRegistrationTimeout();

  try {
    await Promise.race([registration, timeout.promise]);
  } finally {
    timeout.cancel();
    void registration.catch(() => undefined);
  }
}

export function createDesktopSignIn(dependencies: DesktopSignInDependencies) {
  return async () => {
    await waitForDesktopProtocolRegistration(dependencies);

    await dependencies.openWebHandoff(
      `${dependencies.webBaseUrl}/api/auth/desktop?handoff=1`,
    );
  };
}

export async function listenForDesktopAuth(onToken: (token: string) => void) {
  void waitForDesktopProtocolRegistration({ isRegistered, register }).catch(
    () => undefined,
  );

  const consumeUrls = (urls: string[] | null) => {
    for (const url of urls ?? []) {
      const token = readTokenFromDeepLink(url);

      if (token) {
        onToken(token);
      }
    }
  };

  consumeUrls(await getCurrent());

  return onOpenUrl(consumeUrls);
}
