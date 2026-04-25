import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import Discord from "next-auth/providers/discord";
import { SignJWT } from "jose";

process.env.NEXTAUTH_URL ??= process.env.AUTH_URL;
process.env.NEXTAUTH_SECRET ??= process.env.AUTH_SECRET;

const nextAuthSecret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
const discordClientId =
  process.env.DISCORD_CLIENT_ID ?? process.env.AUTH_DISCORD_ID ?? "";
const discordClientSecret =
  process.env.DISCORD_CLIENT_SECRET ?? process.env.AUTH_DISCORD_SECRET ?? "";
const apiBaseUrl = process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";
const encoder = new TextEncoder();

async function createInternalApiToken() {
  if (!nextAuthSecret) {
    throw new Error("NEXTAUTH_SECRET is not configured.");
  }

  return new SignJWT({ purpose: "discord-identity-sync" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("60s")
    .setIssuer("shadow-cloud-web")
    .setAudience("shadow-cloud-internal")
    .setSubject("discord-identity-sync")
    .sign(encoder.encode(nextAuthSecret));
}

async function syncDiscordIdentity(input: {
  provider: string;
  providerId: string;
  email: string;
  displayName: string;
}) {
  if (!nextAuthSecret) {
    throw new Error("NEXTAUTH_SECRET is not configured.");
  }

  const internalToken = await createInternalApiToken();

  const response = await fetch(`${apiBaseUrl}/v1/auth/discord/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${internalToken}`,
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string | string[];
      error?: string;
    } | null;
    const message = Array.isArray(payload?.message)
      ? payload.message.join(", ")
      : (payload?.message ??
        payload?.error ??
        "Failed to sync the Discord identity.");

    throw new Error(message);
  }

  return response.json() as Promise<{
    id: string;
    email: string;
    displayName: string;
    isShadowOverride: boolean;
  }>;
}

export const authOptions: NextAuthOptions = {
  secret: nextAuthSecret,
  providers: [
    Discord({
      clientId: discordClientId,
      clientSecret: discordClientSecret,
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, account, user }) {
      if (account?.provider === "discord") {
        const email =
          user.email ??
          `${account.providerAccountId}@discord.shadow-cloud.local`;
        const displayName =
          user.name ?? email.split("@")[0] ?? "Shadow Overlord";
        const shadowUser = await syncDiscordIdentity({
          provider: account.provider,
          providerId: account.providerAccountId,
          email,
          displayName,
        });

        token.userId = shadowUser.id;
        token.discordId = account.providerAccountId;
        token.isShadowOverride = shadowUser.isShadowOverride;
        token.picture = user.image ?? null;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && token.userId) {
        session.user.id = token.userId;
      }

      if (session.user && token.discordId) {
        session.user.discordId = token.discordId;
      }

      if (session.user) {
        session.user.isShadowOverride = token.isShadowOverride === true;
      }

      return session;
    },
  },
  pages: {
    signIn: "/",
  },
};

export function getServerAuthSession() {
  return getServerSession(authOptions);
}

export async function createApiAccessToken(
  session: Awaited<ReturnType<typeof getServerAuthSession>>,
) {
  if (!session?.user?.id) {
    return null;
  }

  if (!nextAuthSecret) {
    throw new Error("NEXTAUTH_SECRET is not configured.");
  }

  return new SignJWT({
    email: session.user.email ?? undefined,
    name: session.user.name ?? undefined,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .setSubject(session.user.id)
    .sign(encoder.encode(nextAuthSecret));
}
