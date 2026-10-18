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
    gameNumber: string;
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
  const { gameNumber } = await params;
  const query = await searchParams;
  const [session, game] = await Promise.all([
    getServerAuthSession(),
    getGameDetail(gameNumber),
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
          className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em] text-terminal-300/70 transition-colors hover:text-terminal-200"
          href={`/games/${game.gameNumber}`}
        >
          <span aria-hidden="true">◀</span>
          Game overview
        </Link>
      </div>
      {query.upload === "error" ? (
        <p className="font-mono text-xs text-destructive">
          {uploadMessage ?? "The save upload failed."}
        </p>
      ) : null}

      <section>
        {!session?.user ? (
          <Card>
            <CardHeader>
              <CardTitle>Save upload</CardTitle>
              <CardDescription>
                Sign in with Discord to upload your turn save.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LoginButton />
            </CardContent>
          </Card>
        ) : isActivePlayer ? (
          <UploadSaveForm
            gameNumber={game.gameNumber}
            saveBaseline={game.saveBaseline}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Save upload</CardTitle>
              <CardDescription>
                Only the active lord can submit the next save for this round.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border border-terminal-400/20 bg-terminal-400/5 px-4 py-4 font-mono text-sm text-terminal-300">
                {`Waiting for ${game.activePlayerDisplayName} to upload the current turn.`}
              </div>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
