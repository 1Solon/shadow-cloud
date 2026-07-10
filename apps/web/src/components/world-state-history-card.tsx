import { DownloadSaveButton } from "@/components/download-save-button";
import { ReplaceSaveFileAction } from "@/components/replace-save-file-action";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Card,
} from "@/components/ui/card";
import { canReplaceSaveFile } from "@/lib/save-file-replacement";
import type { GameDetailFileVersion } from "@/lib/shadow-cloud-api";

type WorldStateHistoryCardProps = {
  currentUserId: string | null;
  fileVersions: GameDetailFileVersion[];
  gameNumber: number;
  isShadowOverrideUser: boolean;
  shadowOverrideEnabled: boolean;
};

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function WorldStateHistoryCard({
  currentUserId,
  fileVersions,
  gameNumber,
  isShadowOverrideUser,
  shadowOverrideEnabled,
}: WorldStateHistoryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>World states:</CardTitle>
        <CardDescription>
          The current state of the game world, including all uploaded turn
          files.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {fileVersions.length === 0 ? (
          <div className="rounded-lg border border-orange-400/20 bg-orange-400/5 px-4 py-4 text-sm text-orange-300 font-mono">
            No turn files have been uploaded yet.
          </div>
        ) : (
          fileVersions.map((fileVersion, index) => {
            const isMostRecent = index === 0;
            const metadataClassName = `mt-2 text-sm font-mono ${isMostRecent ? "text-black/60" : "text-orange-300/70"}`;
            const canReplace = canReplaceSaveFile({
              currentUserId,
              uploadedById: fileVersion.uploadedById,
              isShadowOverrideUser,
              shadowOverrideEnabled,
            });

            return (
              <div
                key={fileVersion.id}
                className={`rounded-lg border px-4 py-4 ${isMostRecent ? "border-orange-400 bg-orange-400 text-black" : "border-orange-400/20 bg-orange-400/5"}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div
                    className={`font-medium ${isMostRecent ? "text-black" : "text-orange-300"}`}
                  >
                    {fileVersion.originalName}
                  </div>
                  <div className="flex items-center gap-3">
                    <DownloadSaveButton
                      className={`inline-flex h-9 items-center rounded-md border px-3 text-xs font-medium uppercase tracking-[0.18em] font-mono transition-colors ${isMostRecent ? "border-black bg-black/10 text-black hover:bg-black hover:text-orange-400" : "border-orange-400 bg-orange-400/10 text-orange-300 hover:bg-orange-400 hover:text-black"}`}
                      fileName={fileVersion.originalName}
                      href={`/api/games/${gameNumber}/files/${fileVersion.id}`}
                    />
                    {canReplace ? (
                      <ReplaceSaveFileAction
                        canonicalFileName={fileVersion.originalName}
                        fileVersionId={fileVersion.id}
                        gameNumber={gameNumber}
                        isMostRecent={isMostRecent}
                      />
                    ) : null}
                  </div>
                </div>
                <div className={metadataClassName}>
                  Uploaded by {fileVersion.uploadedByDisplayName} on{" "}
                  {formatTimestamp(fileVersion.uploadedAt)}
                </div>
                {fileVersion.replacedAt && fileVersion.replacedByDisplayName ? (
                  <div className={metadataClassName}>
                    Corrected by {fileVersion.replacedByDisplayName} on{" "}
                    {formatTimestamp(fileVersion.replacedAt)}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
