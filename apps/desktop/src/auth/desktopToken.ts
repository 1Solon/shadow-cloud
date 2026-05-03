type DesktopTokenPayload = {
  email?: unknown;
  name?: unknown;
  picture?: unknown;
  sub?: unknown;
};

function decodeBase64Url(input: string) {
  const padded = input.padEnd(
    input.length + ((4 - (input.length % 4)) % 4),
    "=",
  );
  const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64);
}

function decodeDesktopTokenPayload(token: string): DesktopTokenPayload | null {
  const payload = token.split(".")[1];

  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(payload)) as DesktopTokenPayload;
  } catch {
    return null;
  }
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function decodeDesktopTokenSubject(token: string) {
  return cleanString(decodeDesktopTokenPayload(token)?.sub);
}

export function decodeDesktopTokenDisplayName(token: string) {
  const payload = decodeDesktopTokenPayload(token);
  const name = cleanString(payload?.name);

  if (name) {
    return name;
  }

  const email = cleanString(payload?.email);
  return email ? email.split("@")[0] : null;
}

export function decodeDesktopTokenAvatarUrl(token: string) {
  return cleanString(decodeDesktopTokenPayload(token)?.picture);
}
