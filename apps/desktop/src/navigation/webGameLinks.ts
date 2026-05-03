export function buildWebGameUrl(webBaseUrl: string, gameNumber: number) {
  return `${webBaseUrl.replace(/\/+$/g, "")}/games/${encodeURIComponent(
    String(gameNumber),
  )}`;
}
