import { UploadSaveForm } from "@/components/upload-save-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SaveUploadCardProps = {
  saveBaseline?: string;
  activePlayerDisplayName: string;
  gameNumber: number;
  isActivePlayer: boolean;
  isSignedIn: boolean;
};

export function SaveUploadCard({
  saveBaseline,
  activePlayerDisplayName,
  gameNumber,
  isActivePlayer,
  isSignedIn,
}: SaveUploadCardProps) {
  return (
    <Card className="border-0">
      <CardHeader>
        <CardTitle>Save upload</CardTitle>
        <CardDescription>
          Only the active lord can submit the next save for this round.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isActivePlayer ? (
          <UploadSaveForm gameNumber={gameNumber} saveBaseline={saveBaseline} />
        ) : (
          <div className="rounded-md border border-terminal-400/20 bg-terminal-400/5 px-4 py-4 font-mono text-sm text-terminal-300">
            {isSignedIn
              ? `Waiting for ${activePlayerDisplayName} to upload the current turn.`
              : "Sign in with Discord to upload or download game saves."}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
