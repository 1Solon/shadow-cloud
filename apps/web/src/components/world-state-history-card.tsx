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
  saveBaseline?: string;
  currentUserId: string | null;
  fileVersions: GameDetailFileVersion[];
  gameNumber: number;
  isShadowOverrideUser: boolean;
  shadowOverrideEnabled: boolean;
};

const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatTimestamp(timestamp: string) {
  return `${timestampFormatter.format(new Date(timestamp))} UTC`;
}

export function WorldStateHistoryCard({
  saveBaseline,
  currentUserId,
  fileVersions,
  gameNumber,
  isShadowOverrideUser,
  shadowOverrideEnabled,
}: WorldStateHistoryCardProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-4 sm:p-5">
        <CardTitle>Save history:</CardTitle>
        <CardDescription>
          Download previous saves or correct a file you uploaded.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-5 sm:pt-0">
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
            <table
              className="history-table history-table--stacked w-full text-left text-xs font-mono sm:min-w-[44rem] sm:text-sm"
              role="table"
            >
              <caption className="sr-only">Campaign save history</caption>
              <thead
                className="border-b border-orange-400/30 bg-orange-400/10 text-xs uppercase tracking-[0.18em] text-orange-300/80"
                role="rowgroup"
              >
                <tr className="h-10" role="row">
                  <th
                    className="px-3 py-2 sm:px-4 sm:py-3"
                    role="columnheader"
                    scope="col"
                  >
                    Save file
                  </th>
                  <th
                    className="px-3 py-2 sm:px-4 sm:py-3"
                    role="columnheader"
                    scope="col"
                  >
                    Uploaded by
                  </th>
                  <th
                    className="px-3 py-2 sm:px-4 sm:py-3"
                    role="columnheader"
                    scope="col"
                  >
                    Uploaded
                  </th>
                  <th
                    className="px-3 py-2 sm:px-4 sm:py-3"
                    role="columnheader"
                    scope="col"
                  >
                    Correction
                  </th>
                  <th
                    className="px-3 py-2 text-right sm:px-4 sm:py-3"
                    role="columnheader"
                    scope="col"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
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
                          ? "h-16 border-b border-orange-400/30 border-l-2 border-l-orange-400 bg-orange-400/10 text-orange-100"
                          : "h-16 border-b border-orange-400/20 bg-orange-400/5 text-orange-200"
                      }
                      role="row"
                    >
                      <td
                        className="break-words px-3 py-2 font-medium sm:px-4 sm:py-3"
                        data-label="Save file"
                        role="cell"
                      >
                        <div className="min-w-0">
                          {isMostRecent ? (
                            <span className="mb-1 block text-[0.65rem] uppercase tracking-[0.16em] text-orange-300/70">
                              Latest save
                            </span>
                          ) : null}
                          <span>{fileVersion.originalName}</span>
                        </div>
                      </td>
                      <td
                        className="break-words px-3 py-2 sm:px-4 sm:py-3"
                        data-label="Uploaded by"
                        role="cell"
                      >
                        {fileVersion.uploadedByDisplayName}
                      </td>
                      <td
                        className="px-3 py-2 sm:px-4 sm:py-3"
                        data-label="Uploaded"
                        role="cell"
                      >
                        <time dateTime={fileVersion.uploadedAt}>
                          {formatTimestamp(fileVersion.uploadedAt)}
                        </time>
                      </td>
                      <td
                        className="break-words px-3 py-2 sm:px-4 sm:py-3"
                        data-label="Correction"
                        role="cell"
                      >
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
                      <td
                        className="px-3 py-2 sm:px-4 sm:py-3"
                        data-label="Actions"
                        role="cell"
                      >
                        <div className="history-table-actions flex flex-wrap items-center justify-end gap-2 sm:gap-3">
                          <DownloadSaveButton
                            className="inline-flex h-9 items-center rounded-md border border-orange-400/70 bg-orange-400/5 px-3 text-xs font-medium uppercase tracking-[0.18em] font-mono text-orange-300 transition-colors hover:bg-orange-400 hover:text-black"
                            fileName={fileVersion.originalName}
                            href={`/api/games/${gameNumber}/files/${fileVersion.id}`}
                            label={
                              isMostRecent ? "Download latest save" : "Download"
                            }
                          />
                          {canReplace ? (
                            <ReplaceSaveFileAction
                              saveBaseline={saveBaseline}
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
