import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerAuthSession } from "@/auth";
import { TerminalConfirmationModal } from "@/components/terminal-confirmation-modal";
import { UploadSaveForm } from "@/components/upload-save-form";
import { LoginButton } from "@/components/login-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getGameDetail } from "@/lib/shadow-cloud-api";

type UploadPageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<{
    upload?: string;
    message?: string;
  }>;
};

export default async function UploadPage({
  params,
  searchParams,
}: UploadPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const [session, game] = await Promise.all([
    getServerAuthSession(),
    getGameDetail(slug),
  ]);

  if (!game) {
    notFound();
  }

  const isActivePlayer = Boolean(
    session?.user?.id && game.activePlayerUserId === session.user.id,
  );
  const uploadMessage = query.message
    ? decodeURIComponent(query.message)
    : null;

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <TerminalConfirmationModal
        confirmation={
          query.upload === "success"
            ? {
                command: "save-upload --dispatch",
                lines: [
                  "[ok] save file accepted into the active campaign archive",
                  "[ok] next lord notification dispatched to the Discord thread",
                  "<SAVE FILE UPLOADED>",
                ],
              }
            : null
        }
      />

      <div>
        <Link
          className="inline-flex items-center text-sm font-mono text-orange-400/70 hover:text-orange-400 transition-colors"
          href={`/games/${slug}`}
        >
          &lt; GAME OVERVIEW
        </Link>
      </div>
      {query.upload === "error" ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300 font-mono">
          {uploadMessage ?? "The save upload failed."}
        </div>
      ) : null}

      {/* Upload section */}
      <section>
        {!session?.user ? (
          <Card>
            <CardHeader>
              <CardTitle>Save Upload:</CardTitle>
              <CardDescription>
                Sign in with Discord to upload your turn save.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LoginButton />
            </CardContent>
          </Card>
        ) : isActivePlayer ? (
          <UploadSaveForm gameSlug={game.slug} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Save Upload:</CardTitle>
              <CardDescription>
                Only the active lord can submit the next save for this round.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-orange-400/20 bg-orange-400/5 px-4 py-4 text-sm text-orange-300 font-mono">
                {`Waiting for ${game.activePlayerDisplayName} to upload the current turn.`}
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
