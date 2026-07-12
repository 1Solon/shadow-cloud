// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CampaignSettingsEditor,
  parsePositiveSafeWholeHours,
} from "@/components/campaign-settings-editor";

const router = {
  push: vi.fn(),
  refresh: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/components/terminal-confirmation-modal", () => ({
  TerminalConfirmationModal: () => null,
}));

const baseProps = {
  armyCount: "ONE_PER_ZONE",
  dlcMode: "NONE",
  gameMode: "TEAMS",
  gameNumber: 22,
  hasAiPlayers: false,
  name: "Campaign 22",
  organizerDisplayName: "Overlord",
  players: [
    {
      id: "seat-1",
      userId: "overlord-1",
      displayName: "Overlord",
      turnOrder: 1,
      isOrganizer: true,
    },
    {
      id: "seat-2",
      userId: "player-2",
      displayName: "Player Two",
      turnOrder: 2,
      isOrganizer: false,
    },
    {
      id: "seat-3",
      userId: null,
      displayName: null,
      turnOrder: 3,
      isOrganizer: false,
    },
  ],
  playerCount: 3,
  roundNumber: 4,
  techLevel: 4,
  turnReminderGraceHours: 12,
  turnReminderRepeatHours: 24,
  turnRemindersEnabled: true,
  turnTargetHours: 24,
  zoneCount: "TWO_ZONE_START",
} satisfies Omit<
  ComponentProps<typeof CampaignSettingsEditor>,
  "section" | "onDirtyChange"
>;

function renderEditor(
  section: ComponentProps<typeof CampaignSettingsEditor>["section"],
  overrides: Partial<ComponentProps<typeof CampaignSettingsEditor>> = {},
) {
  const onDirtyChange = vi.fn();
  const view = render(
    <CampaignSettingsEditor
      {...baseProps}
      section={section}
      onDirtyChange={onDirtyChange}
      {...overrides}
    />,
  );
  return { ...view, onDirtyChange };
}

describe("CampaignSettingsEditor", () => {
  beforeEach(() => {
    router.push.mockReset();
    router.refresh.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(cleanup);

  it("renders only world fields, reports changes, and cancels to the initial value", async () => {
    const user = userEvent.setup();
    const { onDirtyChange } = renderEditor("world");

    expect(screen.getByLabelText("Game mode")).toHaveValue("TEAMS");
    expect(screen.queryByLabelText("Campaign number")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Target turn hours"),
    ).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Game mode"), "FFA");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByLabelText("Game mode")).toHaveValue("TEAMS");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it("renders only identity fields", () => {
    renderEditor("identity");

    expect(screen.getByLabelText("Campaign number")).toHaveValue(22);
    expect(screen.getByLabelText("Campaign name")).toHaveValue("Campaign 22");
    expect(screen.getByLabelText("Overlord")).toHaveValue("seat-1");
    expect(screen.getByLabelText("Round")).toHaveValue(4);
    expect(screen.getByLabelText("Player count")).toHaveValue(3);
    expect(screen.queryByLabelText("Game mode")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Target turn hours"),
    ).not.toBeInTheDocument();
  });

  it("renders only turn reminder fields", () => {
    renderEditor("turn-protocol");

    expect(screen.getByLabelText("Target turn hours")).toHaveValue(24);
    expect(screen.getByLabelText("Reminder grace hours")).toHaveValue(12);
    expect(screen.getByLabelText("Reminder repeat hours")).toHaveValue(24);
    expect(
      screen.getByRole("checkbox", { name: "Turn reminders enabled" }),
    ).toBeChecked();
    expect(screen.queryByLabelText("Campaign number")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Game mode")).not.toBeInTheDocument();
  });

  it("rejects saving a clean section without fetching", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderEditor("world");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Change at least one detail before saving.",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("submits only changed world fields and initializes known options", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ gameNumber: 22 }), { status: 200 }),
      );
    renderEditor("world");

    expect(screen.getByLabelText("DLC")).toHaveValue("NONE");
    expect(screen.getByLabelText("Tech level")).toHaveValue("4");
    expect(screen.getByLabelText("Zone count")).toHaveValue("TWO_ZONE_START");
    expect(screen.getByLabelText("Army count")).toHaveValue("ONE_PER_ZONE");
    await user.selectOptions(screen.getByLabelText("Game mode"), "FFA_AI");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/games/22/metadata",
        expect.objectContaining({
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ gameMode: "FFA_AI" }),
        }),
      );
    });
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("submits only changed identity metadata and redirects using the response number", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ gameNumber: 37 }), { status: 200 }),
      );
    renderEditor("identity", { onDirtyChange });

    await user.clear(screen.getByLabelText("Campaign number"));
    await user.type(screen.getByLabelText("Campaign number"), "37");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/games/22/metadata",
        expect.objectContaining({ body: JSON.stringify({ gameNumber: 37 }) }),
      );
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
      expect(router.push).toHaveBeenCalledWith("/games/37?metadata=success");
    });
  });

  it("keeps metadata request failures inline with the draft dirty", async () => {
    const user = userEvent.setup();
    const { onDirtyChange } = renderEditor("world");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Metadata rejected." }), {
        status: 400,
      }),
    );

    await user.selectOptions(screen.getByLabelText("Game mode"), "FFA");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Metadata rejected.",
    );
    expect(screen.getByLabelText("Game mode")).toHaveValue("FFA");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("disables the active controls and actions while saving", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    renderEditor("world");

    await user.selectOptions(screen.getByLabelText("Game mode"), "FFA");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Game mode")).toBeDisabled();
      expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    });

    resolveRequest(
      new Response(JSON.stringify({ gameNumber: 22 }), { status: 200 }),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  });

  it("submits one changed turn field and can disable reminders", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ gameNumber: 22 }), { status: 200 }),
      );
    const { rerender } = renderEditor("turn-protocol");

    await user.clear(screen.getByLabelText("Target turn hours"));
    await user.type(screen.getByLabelText("Target turn hours"), "48");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenLastCalledWith(
        "/api/games/22/metadata",
        expect.objectContaining({
          body: JSON.stringify({ turnTargetHours: 48 }),
        }),
      ),
    );

    fetchSpy.mockClear();
    rerender(
      <CampaignSettingsEditor
        {...baseProps}
        section="turn-protocol"
        onDirtyChange={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Turn reminders enabled" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenLastCalledWith(
        "/api/games/22/metadata",
        expect.objectContaining({
          body: JSON.stringify({ turnRemindersEnabled: false }),
        }),
      ),
    );
  });

  it("accepts the maximum timing value", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ gameNumber: 22 }), { status: 200 }),
      );
    renderEditor("turn-protocol");

    await user.clear(screen.getByLabelText("Target turn hours"));
    await user.type(screen.getByLabelText("Target turn hours"), "1000000000");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/games/22/metadata",
        expect.objectContaining({
          body: JSON.stringify({ turnTargetHours: 1_000_000_000 }),
        }),
      ),
    );
  });

  it.each([
    ["Target turn hours", "Target turn"],
    ["Reminder grace hours", "Reminder grace"],
    ["Reminder repeat hours", "Reminder repeat"],
  ])("rejects invalid %s values without fetching", async (field, message) => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderEditor("turn-protocol");

    await user.clear(screen.getByLabelText(field));
    await user.type(screen.getByLabelText(field), "1.5");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lists only occupied seats as Overlord options and can cancel confirmation", async () => {
    const user = userEvent.setup();
    renderEditor("identity");

    const organizer = screen.getByLabelText("Overlord");
    expect(organizer).toHaveTextContent("Seat 1: Overlord");
    expect(organizer).toHaveTextContent("Seat 2: Player Two");
    expect(organizer).not.toHaveTextContent("Seat 3");
    await user.selectOptions(organizer, "seat-2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Confirm Overlord Transfer")).toBeInTheDocument();
    expect(screen.getByText(/Player Two will receive/)).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(
      screen.queryByText("Confirm Overlord Transfer"),
    ).not.toBeInTheDocument();
  });

  it("updates identity metadata before transferring host", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ gameNumber: 37 }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    renderEditor("identity");

    await user.clear(screen.getByLabelText("Campaign number"));
    await user.type(screen.getByLabelText("Campaign number"), "37");
    await user.selectOptions(screen.getByLabelText("Overlord"), "seat-2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(fetchSpy.mock.calls[0]).toEqual([
      "/api/games/22/metadata",
      expect.objectContaining({ body: JSON.stringify({ gameNumber: 37 }) }),
    ]);
    expect(fetchSpy.mock.calls[1]).toEqual([
      "/api/games/37/transfer-host",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ targetPlayerEntryId: "seat-2" }),
      }),
    ]);
    expect(router.push).toHaveBeenCalledWith("/games/37");
  });

  it("keeps a transfer failure inline and the editor dirty", async () => {
    const user = userEvent.setup();
    const { onDirtyChange } = renderEditor("identity");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Transfer rejected." }), {
        status: 403,
      }),
    );

    await user.selectOptions(screen.getByLabelText("Overlord"), "seat-2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Transfer rejected.",
    );
    expect(screen.getByLabelText("Overlord")).toHaveValue("seat-2");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("retries only the transfer against the committed game number after partial success", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ gameNumber: 37 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Transfer rejected." }), {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    renderEditor("identity");

    await user.clear(screen.getByLabelText("Campaign number"));
    await user.type(screen.getByLabelText("Campaign number"), "37");
    await user.selectOptions(screen.getByLabelText("Overlord"), "seat-2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Transfer rejected.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));
    expect(
      fetchSpy.mock.calls.filter(([url]) => String(url).endsWith("/metadata")),
    ).toHaveLength(1);
    expect(fetchSpy.mock.calls[2]?.[0]).toBe("/api/games/37/transfer-host");
  });

  it("keeps committed metadata when cancelling after a transfer failure", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ gameNumber: 37 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Transfer rejected." }), {
          status: 503,
        }),
      );
    renderEditor("identity");

    await user.clear(screen.getByLabelText("Campaign number"));
    await user.type(screen.getByLabelText("Campaign number"), "37");
    await user.selectOptions(screen.getByLabelText("Overlord"), "seat-2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("alert");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByLabelText("Campaign number")).toHaveValue(37);
  });

  it("shows metadata-step failures inside the active transfer dialog", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Metadata rejected." }), {
        status: 400,
      }),
    );
    renderEditor("identity");

    await user.clear(screen.getByLabelText("Campaign number"));
    await user.type(screen.getByLabelText("Campaign number"), "37");
    await user.selectOptions(screen.getByLabelText("Overlord"), "seat-2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Metadata rejected.",
    );
    expect(dialog).toBeVisible();
  });

  it("shows transfer-step failures inside the active transfer dialog", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Transfer rejected." }), {
        status: 403,
      }),
    );
    renderEditor("identity");

    await user.selectOptions(screen.getByLabelText("Overlord"), "seat-2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Transfer rejected.",
    );
    expect(dialog).toBeVisible();
  });

  it("syncs a clean editor to changed authoritative props", async () => {
    const onDirtyChange = vi.fn();
    const { rerender } = renderEditor("identity", { onDirtyChange });

    rerender(
      <CampaignSettingsEditor
        {...baseProps}
        gameNumber={31}
        name="Server campaign"
        section="identity"
        onDirtyChange={onDirtyChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Campaign number")).toHaveValue(31);
      expect(screen.getByLabelText("Campaign name")).toHaveValue(
        "Server campaign",
      );
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("preserves dirty edits across prop updates and cancels to the latest authoritative props", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    const { rerender } = renderEditor("identity", { onDirtyChange });

    await user.clear(screen.getByLabelText("Campaign name"));
    await user.type(screen.getByLabelText("Campaign name"), "Local campaign");
    rerender(
      <CampaignSettingsEditor
        {...baseProps}
        gameNumber={31}
        name="Server campaign"
        section="identity"
        onDirtyChange={onDirtyChange}
      />,
    );

    expect(screen.getByLabelText("Campaign name")).toHaveValue(
      "Local campaign",
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByLabelText("Campaign number")).toHaveValue(31);
    expect(screen.getByLabelText("Campaign name")).toHaveValue(
      "Server campaign",
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it("contains focus, blocks background editing, and restores focus on Escape", async () => {
    const user = userEvent.setup();
    renderEditor("identity");
    const organizer = screen.getByLabelText("Overlord");
    const campaignName = screen.getByLabelText("Campaign name");

    organizer.focus();
    await user.selectOptions(organizer, "seat-2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const dialog = screen.getByRole("dialog");
    await waitFor(() =>
      expect(dialog).toContainElement(
        document.activeElement as HTMLElement | null,
      ),
    );
    expect(campaignName).toBeDisabled();
    expect(organizer).toBeDisabled();
    await user.type(campaignName, " changed");
    expect(campaignName).toHaveValue("Campaign 22");

    await user.tab();
    expect(dialog).toContainElement(
      document.activeElement as HTMLElement | null,
    );
    await user.tab({ shift: true });
    expect(dialog).toContainElement(
      document.activeElement as HTMLElement | null,
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(organizer).toHaveFocus();
  });

  it("refreshes after a successful host-only transfer", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    renderEditor("identity");

    await user.selectOptions(screen.getByLabelText("Overlord"), "seat-2");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  });

  it("does not loop dirty notifications when rerendered", () => {
    const onDirtyChange = vi.fn();
    const { rerender } = renderEditor("world", { onDirtyChange });

    expect(onDirtyChange).toHaveBeenCalledTimes(1);
    rerender(
      <CampaignSettingsEditor
        {...baseProps}
        section="world"
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(onDirtyChange).toHaveBeenCalledTimes(1);
  });

  it("uses flat field rows without card or tile classes", () => {
    renderEditor("world");

    const editor = screen.getByTestId("campaign-settings-editor");
    expect(editor.querySelector("[data-slot='card']")).toBeNull();
    expect(editor.querySelector(".grid-cols-2")).toBeNull();
    expect(editor.querySelector(".space-y-4")).toBeNull();
  });

  it("wraps editor actions on narrow layouts", () => {
    renderEditor("world");

    expect(
      screen.getByRole("button", { name: "Save" }).parentElement,
    ).toHaveClass("flex-wrap");
  });
});

describe("parsePositiveSafeWholeHours", () => {
  it.each([
    "",
    "0",
    "-1",
    "1.5",
    "1e3",
    "1000000001",
    "9007199254740991",
    "9007199254740992",
  ])("rejects invalid policy string %s", (value) => {
    expect(parsePositiveSafeWholeHours(value, "Target turn")).toEqual(
      expect.objectContaining({ ok: false }),
    );
  });

  it("accepts the maximum supported value", () => {
    expect(parsePositiveSafeWholeHours("1000000000", "Target turn")).toEqual({
      ok: true,
      value: 1_000_000_000,
    });
  });
});
