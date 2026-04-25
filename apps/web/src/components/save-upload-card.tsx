import { UploadSaveForm } from "@/components/upload-save-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type SaveUploadCardProps = {
  activePlayerDisplayName: string;
  gameNumber: number;
  isActivePlayer: boolean;
  isSignedIn: boolean;
};

export function SaveUploadCard({
  activePlayerDisplayName,
  gameNumber,
  isActivePlayer,
  isSignedIn,
}: SaveUploadCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Save Upload:</CardTitle>
        <CardDescription>
          Only the active lord can submit the next save for this round.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isActivePlayer ? (
          <UploadSaveForm gameNumber={gameNumber} />
        ) : (
          <div className="rounded-lg border border-orange-400/20 bg-orange-400/5 px-4 py-4 text-sm text-orange-300 font-mono">
            {isSignedIn
              ? `Waiting for ${activePlayerDisplayName} to upload the current turn.`
              : "Sign in with Discord to upload or download game saves."}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
