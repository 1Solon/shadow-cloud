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
    expect(rows[1]).toHaveClass("h-16", "bg-orange-400", "text-black");
    expect(rows[2]).toHaveClass(
      "h-16",
      "bg-orange-400/5",
      "text-orange-200",
    );
    expect(within(rows[1]).getByText("Corrector")).toBeVisible();
    expect(within(rows[2]).getByText("None")).toBeVisible();
    expect(within(table).getAllByText("Owner")).toHaveLength(2);
    expect(
      screen.getByRole("region", { name: "Save history table" }),
    ).toHaveClass("overflow-x-auto", "rounded-lg");
    expect(table).toHaveClass("min-w-[52rem]", "font-mono");
    const saveFileHeader = within(table).getByRole("columnheader", {
      name: "Save file",
    });
    expect(saveFileHeader).toHaveAttribute("scope", "col");
    expect(saveFileHeader.closest("tr")).toHaveClass("h-12");
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
