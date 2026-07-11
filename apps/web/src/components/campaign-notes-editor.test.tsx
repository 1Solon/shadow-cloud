// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignNotesEditor } from "@/components/campaign-notes-editor";

const router = {
  refresh: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const baseProps = {
  gameNumber: 22,
  notes: "Opening note",
} satisfies Omit<ComponentProps<typeof CampaignNotesEditor>, "onDirtyChange">;

function renderEditor(
  overrides: Partial<ComponentProps<typeof CampaignNotesEditor>> = {},
) {
  const onDirtyChange = vi.fn();
  const view = render(
    <CampaignNotesEditor
      {...baseProps}
      onDirtyChange={onDirtyChange}
      {...overrides}
    />,
  );

  return { ...view, onDirtyChange };
}

describe("CampaignNotesEditor", () => {
  beforeEach(() => {
    router.refresh.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(cleanup);

  it("renders a focused labeled Markdown editor without card or edit chrome", async () => {
    const user = userEvent.setup();
    renderEditor();

    const notesField = screen.getByLabelText("Campaign notes");
    expect(notesField).toHaveValue("Opening note");
    await user.click(notesField);
    expect(notesField).toHaveFocus();
    expect(screen.getByText(/Markdown is supported/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getByTestId("campaign-notes-editor")
        .querySelector("[data-slot='card']"),
    ).toBeNull();
  });

  it("initializes null notes as an empty draft", () => {
    renderEditor({ notes: null });

    expect(screen.getByLabelText("Campaign notes")).toHaveValue("");
  });

  it("reports false initially, true after editing, and false after cancel", async () => {
    const user = userEvent.setup();
    const { onDirtyChange } = renderEditor();

    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    await user.type(screen.getByLabelText("Campaign notes"), " changed");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByLabelText("Campaign notes")).toHaveValue("Opening note");
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it("syncs a clean draft to changed authoritative notes", async () => {
    const onDirtyChange = vi.fn();
    const { rerender } = renderEditor({ onDirtyChange });

    rerender(
      <CampaignNotesEditor
        gameNumber={22}
        notes="Server note"
        onDirtyChange={onDirtyChange}
      />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Campaign notes")).toHaveValue(
        "Server note",
      ),
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("preserves a dirty draft across prop updates and cancels to the latest notes", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    const { rerender } = renderEditor({ onDirtyChange });

    await user.clear(screen.getByLabelText("Campaign notes"));
    await user.type(screen.getByLabelText("Campaign notes"), "Local note");
    rerender(
      <CampaignNotesEditor
        gameNumber={22}
        notes="Latest server note"
        onDirtyChange={onDirtyChange}
      />,
    );

    expect(screen.getByLabelText("Campaign notes")).toHaveValue("Local note");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByLabelText("Campaign notes")).toHaveValue(
      "Latest server note",
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it("rejects saving a clean draft without fetching", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { onDirtyChange } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Change the campaign notes before saving.",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("submits the exact nonblank draft, disables controls, and confirms success", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (response: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const { onDirtyChange } = renderEditor();
    const draft = "  # Plan\n\nKeep the edges  ";

    await user.clear(screen.getByLabelText("Campaign notes"));
    await user.type(screen.getByLabelText("Campaign notes"), draft);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(fetchSpy).toHaveBeenCalledWith("/api/games/22/metadata", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: draft }),
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Campaign notes")).toBeDisabled();
      expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    });

    resolveRequest(new Response(null, { status: 204 }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(
      screen.getByRole("button", { name: "Close confirmation" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("> game-notes --commit", {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("<GAME NOTES UPDATED>", {}, { timeout: 5_000 }),
    ).toBeInTheDocument();
  }, 8_000);

  it("submits whitespace-only notes as null", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    renderEditor();

    await user.clear(screen.getByLabelText("Campaign notes"));
    await user.type(screen.getByLabelText("Campaign notes"), " \n\t ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/games/22/metadata",
      expect.objectContaining({ body: JSON.stringify({ notes: null }) }),
    );
  });

  it.each([
    [
      new Response(JSON.stringify({ error: "Notes rejected." }), {
        status: 400,
      }),
      "Notes rejected.",
    ],
    [new Response("not json", { status: 500 }), "The notes update failed."],
  ])(
    "keeps the dirty draft after an HTTP failure",
    async (response, expectedMessage) => {
      const user = userEvent.setup();
      const { onDirtyChange } = renderEditor();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

      await user.clear(screen.getByLabelText("Campaign notes"));
      await user.type(screen.getByLabelText("Campaign notes"), "Local note");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        expectedMessage,
      );
      expect(screen.getByLabelText("Campaign notes")).toHaveValue("Local note");
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    },
  );

  it("handles rejected requests inline without losing the dirty draft", async () => {
    const user = userEvent.setup();
    const { onDirtyChange } = renderEditor();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await user.clear(screen.getByLabelText("Campaign notes"));
    await user.type(screen.getByLabelText("Campaign notes"), "Offline draft");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The notes update failed.",
    );
    expect(screen.getByLabelText("Campaign notes")).toHaveValue(
      "Offline draft",
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("uses an updated game number for the next save", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const onDirtyChange = vi.fn();
    const { rerender } = renderEditor({ onDirtyChange });

    await user.type(screen.getByLabelText("Campaign notes"), " changed");
    rerender(
      <CampaignNotesEditor
        gameNumber={37}
        notes="Opening note"
        onDirtyChange={onDirtyChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/games/37/metadata");
  });

  it("clears errors and confirmation when cancelling", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    renderEditor();

    await user.type(screen.getByLabelText("Campaign notes"), " changed");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Campaign notes")).toHaveValue("Opening note");
  });

  it("does not repeat dirty notifications on an equivalent rerender", () => {
    const onDirtyChange = vi.fn();
    const { rerender } = renderEditor({ onDirtyChange });

    expect(onDirtyChange).toHaveBeenCalledTimes(1);
    rerender(
      <CampaignNotesEditor {...baseProps} onDirtyChange={onDirtyChange} />,
    );

    expect(onDirtyChange).toHaveBeenCalledTimes(1);
  });

  it("uses flat responsive terminal layout classes", () => {
    renderEditor();

    const editor = screen.getByTestId("campaign-notes-editor");
    const actions = screen.getByTestId("campaign-notes-actions");
    expect(editor).toHaveClass("min-w-0");
    expect(actions).toHaveClass("flex-wrap");
    expect(editor.className).not.toMatch(/\bspace-[xy]-/);
    expect(
      editor.querySelector(".space-x-2, .space-y-2, .space-y-4"),
    ).toBeNull();
  });
});
