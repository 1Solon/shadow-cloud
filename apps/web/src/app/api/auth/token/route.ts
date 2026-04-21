import { createApiAccessToken, getServerAuthSession } from "@/auth";

export async function GET() {
  const session = await getServerAuthSession();

  if (!session?.user?.id) {
    return Response.json(
      { error: "Authentication is required." },
      { status: 401 },
    );
  }

  const token = await createApiAccessToken(session).catch(() => null);

  if (!token) {
    return Response.json(
      { error: "NEXTAUTH_SECRET is not configured." },
      { status: 500 },
    );
  }

  return Response.json({ token });
}
