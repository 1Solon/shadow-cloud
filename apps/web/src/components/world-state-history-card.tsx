import { DownloadSaveButton } from "@/components/download-save-button";
import { LocalTimestamp } from "@/components/local-timestamp";
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
import {
  tableCell,
  tableCurrentRow,
  tableHead,
  tableHeaderCell,
  tableRow,
} from "@/lib/terminal-styles";
import { cn } from "@/lib/utils";

type WorldStateHistoryCardProps = {
  saveBaseline?: string;
  currentUserId: string | null;
  fileVersions: GameDetailFileVersion[];
  gameNumber: number;
  isShadowOverrideUser: boolean;
  shadowOverrideEnabled: boolean;
};

export function WorldStateHistoryCard({
  saveBaseline,
  currentUserId,
  fileVersions,
  gameNumber,
  isShadowOverrideUser,
  shadowOverrideEnabled,
}: WorldStateHistoryCardProps) {
  const hasSaves = fileVersions.length > 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-4 sm:p-5">
        <CardTitle>Save history</CardTitle>
        <CardDescription>
          Download previous saves or correct a file you uploaded.
        </CardDescription>
      </CardHeader>
      <CardContent
        className={hasSaves ? "p-0 sm:p-0" : "p-4 pt-0 sm:p-5 sm:pt-0"}
      >
        {hasSaves ? (
          <div
            aria-label="Save history table"
            className="overflow-x-auto"
            role="region"
            tabIndex={0}
          >
            <table
              className="history-table history-table--stacked w-full text-left font-mono text-sm sm:min-w-[44rem]"
              role="table"
            >
              <caption className="sr-only">Campaign save history</caption>
              <thead className={tableHead} role="rowgroup">
                <tr role="row">
                  <th
                    className={tableHeaderCell}
                    role="columnheader"
                    scope="col"
                  >
                    Save file
                  </th>
                  <th
                    className={tableHeaderCell}
                    role="columnheader"
                    scope="col"
                  >
                    Uploaded by
                  </th>
                  <th
                    className={tableHeaderCell}
                    role="columnheader"
                    scope="col"
                  >
                    Uploaded
                  </th>
                  <th
                    className={tableHeaderCell}
                    role="columnheader"
                    scope="col"
                  >
                    Corrected
                  </th>
                  <th
                    className={tableHeaderCell}
                    role="columnheader"
                    scope="col"
                  >
                    <span className="sr-only">Actions</span>
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
                      className={cn(tableRow, isMostRecent && tableCurrentRow)}
                      role="row"
                    >
                      <td
                        className={cn(tableCell, "break-words")}
                        data-label="Save file"
                        role="cell"
                      >
                        {isMostRecent ? (
                          <span className="sr-only">Latest save</span>
                        ) : null}
                        <span>{fileVersion.originalName}</span>
                      </td>
                      <td
                        className={cn(tableCell, "break-words")}
                        data-label="Uploaded by"
                        role="cell"
                      >
                        {fileVersion.uploadedByDisplayName}
                      </td>
                      <td
                        className={cn(tableCell, "whitespace-nowrap")}
                        data-label="Uploaded"
                        role="cell"
                      >
                        <LocalTimestamp
                          compact
                          timestamp={fileVersion.uploadedAt}
                        />
                      </td>
                      <td
                        className={cn(tableCell, "break-words")}
                        data-label="Corrected"
                        role="cell"
                      >
                        {fileVersion.replacedAt &&
                        fileVersion.replacedByDisplayName ? (
                          <>
                            {fileVersion.replacedByDisplayName}
                            <span className="block text-xs text-terminal-300/70">
                              <LocalTimestamp
                                compact
                                timestamp={fileVersion.replacedAt}
                              />
                            </span>
                          </>
                        ) : (
                          <>
                            <span
                              aria-hidden="true"
                              className="text-terminal-300/50"
                            >
                              —
                            </span>
                            <span className="sr-only">None</span>
                          </>
                        )}
                      </td>
                      <td
                        className={cn(tableCell, "py-1.5")}
                        data-label="Actions"
                        role="cell"
                      >
                        <div className="history-table-actions flex flex-wrap items-center justify-end gap-2">
                          <DownloadSaveButton
                            className="max-sm:min-h-11"
                            size="sm"
                            variant="outline"
                            fileName={fileVersion.originalName}
                            href={`/api/games/${gameNumber}/files/${fileVersion.id}?revision=${fileVersion.contentRevision}`}
                          />
                          {canReplace ? (
                            <ReplaceSaveFileAction
                              saveBaseline={saveBaseline}
                              canonicalFileName={fileVersion.originalName}
                              fileVersionId={fileVersion.id}
                              gameNumber={gameNumber}
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
        ) : (
          <div
            className="rounded-md border border-terminal-400/20 bg-terminal-400/5 px-4 py-4 font-mono text-sm text-terminal-300"
            role="status"
          >
            No campaign saves have been uploaded yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
