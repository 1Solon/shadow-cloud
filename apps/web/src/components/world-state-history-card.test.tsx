// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorldStateHistoryCard } from "@/components/world-state-history-card";
import type { GameDetailFileVersion } from "@/lib/shadow-cloud-api";

vi.mock("@/components/download-save-button", () => ({
  DownloadSaveButton: ({
    fileName,
    href,
  }: {
    fileName: string;
    href: string;
  }) => <a href={href}>{fileName}</a>,
}));

vi.mock("@/components/replace-save-file-action", () => ({
  ReplaceSaveFileAction: ({
    canonicalFileName,
    fileVersionId,
    isMostRecent,
  }: {
    canonicalFileName: string;
    fileVersionId: string;
    isMostRecent: boolean;
  }) => (
    <button
      aria-label={`Replace ${canonicalFileName}`}
      data-file-version-id={fileVersionId}
      data-most-recent={String(isMostRecent)}
      type="button"
    >
      Replace
    </button>
  ),
}));

function createFileVersion(
  overrides: Partial<GameDetailFileVersion> = {},
): GameDetailFileVersion {
  return {
    id: "version-1",
    originalName: "42-T4-S2-Owner.se1",
    uploadedAt: "2026-07-10T19:00:00.000Z",
    uploadedById: "owner-1",
    uploadedByDisplayName: "Owner",
    contentHash: null,
    idempotencyKey: null,
    replacedAt: null,
    replacedByDisplayName: null,
    ...overrides,
  };
}

function renderHistory(
  fileVersions: GameDetailFileVersion[],
  overrides: Partial<{
    currentUserId: string | null;
    isShadowOverrideUser: boolean;
    shadowOverrideEnabled: boolean;
  }> = {},
) {
  return render(
    <WorldStateHistoryCard
      currentUserId={overrides.currentUserId ?? "owner-1"}
      fileVersions={fileVersions}
      gameNumber={42}
      isShadowOverrideUser={overrides.isShadowOverrideUser ?? false}
      shadowOverrideEnabled={overrides.shadowOverrideEnabled ?? false}
    />,
  );
}

describe("WorldStateHistoryCard", () => {
  afterEach(cleanup);

  it("renders owner replacement controls without changing history rows", () => {
    const latest = createFileVersion({
      id: "version-latest",
      originalName: "42-T4-S3-Latest.se1",
      replacedAt: "2026-07-10T20:00:00.000Z",
      replacedByDisplayName: "Corrector",
    });
    const older = createFileVersion({
      id: "version-older",
      originalName: "42-T4-S2-Older.se1",
    });

    renderHistory([latest, older]);

    expect(
      screen.getByRole("button", { name: "Replace 42-T4-S3-Latest.se1" }),
    ).toHaveAttribute("data-most-recent", "true");
    expect(
      screen.getByRole("button", { name: "Replace 42-T4-S2-Older.se1" }),
    ).toHaveAttribute("data-most-recent", "false");
    expect(
      screen.getByRole("link", { name: "42-T4-S3-Latest.se1" }),
    ).toHaveAttribute("href", "/api/games/42/files/version-latest");
    expect(
      screen.getByRole("link", { name: "42-T4-S2-Older.se1" }),
    ).toHaveAttribute("href", "/api/games/42/files/version-older");
    const table = screen.getByRole("table", { name: "Campaign save history" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(table).toHaveAttribute("role", "table");
    const rowGroups = within(table).getAllByRole("rowgroup");
    expect(rowGroups).toHaveLength(2);
    expect(rowGroups[0]).toBe(table.querySelector("thead"));
    expect(rowGroups[1]).toBe(table.querySelector("tbody"));
    expect(table.querySelector("thead")).not.toHaveAttribute("aria-hidden");
    expect(table.querySelector("thead")).not.toHaveAttribute("hidden");
    expect(
      Array.from(table.querySelectorAll("thead, tbody"), (rowGroup) =>
        rowGroup.getAttribute("role"),
      ),
    ).toEqual(["rowgroup", "rowgroup"]);
    expect(
      Array.from(table.querySelectorAll("tr"), (row) =>
        row.getAttribute("role"),
      ),
    ).toEqual(["row", "row", "row"]);
    expect(
      Array.from(table.querySelectorAll("thead th"), (header) =>
        header.getAttribute("role"),
      ),
    ).toEqual([
      "columnheader",
      "columnheader",
      "columnheader",
      "columnheader",
      "columnheader",
    ]);
    expect(
      Array.from(table.querySelectorAll("thead th"), (header) =>
        header.getAttribute("scope"),
      ).every((scope) => scope === "col"),
    ).toBe(true);
    expect(
      Array.from(table.querySelectorAll("tbody td"), (cell) =>
        cell.getAttribute("role"),
      ).every((role) => role === "cell"),
    ).toBe(true);
    expect(within(rows[0]).getAllByRole("columnheader")).toHaveLength(5);
    expect(within(rows[1]).getAllByRole("cell")).toHaveLength(5);
    expect(within(rows[2]).getAllByRole("cell")).toHaveLength(5);
    expect(rows[1]).toHaveClass(
      "h-16",
      "border-l-2",
      "border-l-orange-400",
      "bg-orange-400/10",
      "text-orange-100",
    );
    expect(rows[2]).toHaveClass("h-16", "bg-orange-400/5", "text-orange-200");
    expect(within(rows[1]).getByText("Latest save")).toBeVisible();
    expect(within(rows[1]).getByText("Corrector")).toBeVisible();
    expect(within(rows[2]).getByText("None")).toBeVisible();
    expect(within(table).getAllByText("Owner")).toHaveLength(2);
    expect(
      screen.getByRole("region", { name: "Save history table" }),
    ).toHaveClass("overflow-x-auto", "rounded-lg");
    expect(table).toHaveClass(
      "history-table",
      "history-table--stacked",
      "sm:min-w-[44rem]",
      "font-mono",
    );
    expect(
      Array.from(table.querySelectorAll("tbody td"), (cell) =>
        cell.getAttribute("data-label"),
      ),
    ).toEqual([
      "Save file",
      "Uploaded by",
      "Uploaded",
      "Correction",
      "Actions",
      "Save file",
      "Uploaded by",
      "Uploaded",
      "Correction",
      "Actions",
    ]);
    expect(
      screen.getAllByRole("button", {
        name: "Replace 42-T4-S3-Latest.se1",
      }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("button", {
        name: "Replace 42-T4-S2-Older.se1",
      }),
    ).toHaveLength(1);
    expect(
      within(rows[1]).getByText(
        `${new Intl.DateTimeFormat("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(latest.uploadedAt))} local`,
        { exact: true },
      ),
    ).toBeInTheDocument();
    expect(within(rows[1]).getAllByRole("link")).toHaveLength(1);
    expect(within(rows[1]).getAllByRole("button")).toHaveLength(1);
    expect(within(rows[2]).getAllByRole("link")).toHaveLength(1);
    expect(within(rows[2]).getAllByRole("button")).toHaveLength(1);
    const saveFileHeader = within(table).getByRole("columnheader", {
      name: "Save file",
    });
    expect(saveFileHeader).toHaveAttribute("scope", "col");
    expect(saveFileHeader.closest("tr")).toHaveClass("h-10");
  });

  it("renders replacement controls for an enabled Shadow override user", () => {
    renderHistory([createFileVersion()], {
      currentUserId: "shadow-1",
      isShadowOverrideUser: true,
      shadowOverrideEnabled: true,
    });

    expect(
      screen.getByRole("button", { name: "Replace 42-T4-S2-Owner.se1" }),
    ).toBeInTheDocument();
  });

  it("does not render replacement controls for a disabled Shadow override", () => {
    renderHistory([createFileVersion()], {
      currentUserId: "shadow-1",
      isShadowOverrideUser: true,
      shadowOverrideEnabled: false,
    });

    expect(
      screen.queryByRole("button", { name: /Replace/ }),
    ).not.toBeInTheDocument();
  });

  it("renders correction metadata only when both correction fields are present", () => {
    renderHistory([
      createFileVersion({
        id: "corrected",
        replacedAt: "2026-07-10T20:00:00.000Z",
        replacedByDisplayName: "Corrector",
      }),
      createFileVersion({
        id: "missing-time",
        replacedByDisplayName: "Missing time",
      }),
      createFileVersion({
        id: "missing-user",
        replacedAt: "2026-07-10T20:00:00.000Z",
      }),
    ]);

    expect(screen.getByText("Corrector")).toBeInTheDocument();
    expect(screen.queryByText("Missing time")).not.toBeInTheDocument();
    expect(screen.getAllByText("None")).toHaveLength(2);
  });

  it("renders the save empty state without a table", () => {
    renderHistory([]);

    expect(
      screen.getByText("No campaign saves have been uploaded yet."),
    ).toHaveAttribute("role", "status");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
