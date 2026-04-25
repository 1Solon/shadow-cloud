import { cookies } from "next/headers";

export const shadowOverrideCookieName = "shadow-override";

export async function getShadowOverrideEnabled() {
  const cookieStore = await cookies();

  return cookieStore.get(shadowOverrideCookieName)?.value === "enabled";
}