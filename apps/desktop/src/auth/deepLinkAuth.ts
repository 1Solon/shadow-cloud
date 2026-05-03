import { getCurrent, onOpenUrl, register } from '@tauri-apps/plugin-deep-link';
import { openUrl } from '@tauri-apps/plugin-opener';
import { webBaseUrl } from '@/api/shadowCloudApi';

const protocol = 'shadow-cloud';

export function readTokenFromDeepLink(url: string) {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== `${protocol}:` || parsedUrl.hostname !== 'auth') {
      return null;
    }

    return parsedUrl.searchParams.get('token');
  } catch {
    return null;
  }
}

export async function startDesktopSignIn() {
  await register(protocol).catch(() => undefined);
  await openUrl(`${webBaseUrl}/api/auth/desktop`);
}

export async function listenForDesktopAuth(
  onToken: (token: string) => void,
) {
  await register(protocol).catch(() => undefined);

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
