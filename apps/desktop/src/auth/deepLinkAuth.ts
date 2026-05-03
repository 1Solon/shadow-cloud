import {
  getCurrent,
  isRegistered,
  onOpenUrl,
  register,
} from "@tauri-apps/plugin-deep-link";
import { openUrl } from "@tauri-apps/plugin-opener";
import { webBaseUrl } from "@/api/shadowCloudApi";

const protocol = "shadow-cloud";

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

export function createDesktopSignIn(dependencies: DesktopSignInDependencies) {
  return async () => {
    await dependencies.register(protocol);

    if (!(await dependencies.isRegistered(protocol))) {
      throw new Error("Desktop protocol registration did not complete.");
    }

    await dependencies.openWebHandoff(
      `${dependencies.webBaseUrl}/api/auth/desktop?handoff=1`,
    );
  };
}

export async function listenForDesktopAuth(onToken: (token: string) => void) {
  await register(protocol);

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
