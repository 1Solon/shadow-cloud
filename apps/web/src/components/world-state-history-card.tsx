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
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Save history:</CardTitle>
        <CardDescription>
          Download previous saves or correct a file you uploaded.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {fileVersions.length === 0 ? (
          <div
            className="rounded-lg border border-orange-400/20 bg-orange-400/5 px-4 py-4 text-sm font-mono text-orange-300"
            role="status"
          >
            No campaign saves have been uploaded yet.
          </div>
        ) : (
          <div
            aria-label="Save history table"
            className="overflow-x-auto rounded-lg border border-orange-400/20"
            role="region"
            tabIndex={0}
          >
            <table className="min-w-[52rem] w-full text-left text-sm font-mono">
              <caption className="sr-only">Campaign save history</caption>
              <thead className="border-b border-orange-400/30 bg-orange-400/10 text-xs uppercase tracking-[0.18em] text-orange-300/80">
                <tr className="h-12">
                  <th className="px-4 py-3" scope="col">
                    Save file
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Uploaded by
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Uploaded
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Correction
                  </th>
                  <th className="px-4 py-3 text-right" scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {fileVersions.map((fileVersion, index) => {
                  const isMostRecent = index === 0;
                  const canReplace = canReplaceSaveFile({
                    currentUserId,
                    uploadedById: fileVersion.uploadedById,
                    isShadowOverrideUser,
                    shadowOverrideEnabled,
                  });

                  return (
                    <tr
                      key={fileVersion.id}
                      className={
                        isMostRecent
                          ? "h-16 border-b border-orange-400 bg-orange-400 text-black"
                          : "h-16 border-b border-orange-400/20 bg-orange-400/5 text-orange-200"
                      }
                    >
                      <td className="px-4 py-3 font-medium">
                        {fileVersion.originalName}
                      </td>
                      <td className="px-4 py-3">
                        {fileVersion.uploadedByDisplayName}
                      </td>
                      <td className="px-4 py-3">
                        <time dateTime={fileVersion.uploadedAt}>
                          {formatTimestamp(fileVersion.uploadedAt)}
                        </time>
                      </td>
                      <td className="px-4 py-3">
                        {fileVersion.replacedAt &&
                        fileVersion.replacedByDisplayName ? (
                          <>
                            {fileVersion.replacedByDisplayName}
                            <span className="block text-xs opacity-70">
                              <time dateTime={fileVersion.replacedAt}>
                                {formatTimestamp(fileVersion.replacedAt)}
                              </time>
                            </span>
                          </>
                        ) : (
                          "None"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
