// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RejectSaveAction } from "@/components/reject-save-action";

const { mockRouter } = vi.hoisted(() => ({
  mockRouter: {
    refresh: vi.fn(),
    replace: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
}));

const fetchMock = vi.fn();

function mockResponse(
  ok: boolean,
  payload: { error?: string } = {},
  status = ok ? 200 : 500,
): Response {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function renderAction(
  overrides: Partial<React.ComponentProps<typeof RejectSaveAction>> = {},
) {
  return render(
    <RejectSaveAction
      fileName="42-T4-S2-Rhea.se1"
      fileVersionId="save-9"
      gameNumber={42}
      label="Reject"
      saveBaseline="campaign:4:9"
      uploaderDisplayName="Rhea"
      {...overrides}
    />,
  );
}

describe("RejectSaveAction", () => {
  beforeEach(() => {
    mockRouter.refresh.mockReset();
    mockRouter.replace.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("explains that the save is discarded and the turn returns to the uploader", async () => {
    const user = userEvent.setup();
    renderAction();

    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Reject latest save")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "The turn returns to Rhea, and their turn time continues.",
        {},
        { timeout: 5_000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("42-T4-S2-Rhea.se1 will be discarded."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("labels the uploader's action as a withdrawal", async () => {
    const user = userEvent.setup();
    renderAction({ label: "Withdraw" });

    expect(
      screen.queryByRole("button", { name: "Reject" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Withdraw" }));

    expect(screen.getByText("Withdraw latest save")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Withdraw save" }),
    ).toBeInTheDocument();
  });

  it("posts the save baseline seen when the dialog opened and refreshes on success", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(mockResponse(true));
    const view = renderAction();

    await user.click(screen.getByRole("button", { name: "Reject" }));
    view.rerender(
      <RejectSaveAction
        fileName="42-T4-S2-Rhea.se1"
        fileVersionId="save-9"
        gameNumber={42}
        label="Reject"
        saveBaseline="campaign:4:10"
        uploaderDisplayName="Rhea"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Reject save" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/games/42/files/save-9/reject",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedSaveBaseline: "campaign:4:9" }),
      },
    );
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the API message inline and keeps the dialog open on failure", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      mockResponse(
        false,
        {
          error:
            "This save can no longer be rejected because the campaign has moved on since it was uploaded.",
        },
        409,
      ),
    );
    renderAction();

    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.click(screen.getByRole("button", { name: "Reject save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This save can no longer be rejected because the campaign has moved on since it was uploaded.",
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject save" })).toBeEnabled();
    expect(mockRouter.refresh).not.toHaveBeenCalled();
  });

  it("reports a network failure without closing the dialog", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new Error("Network unavailable"));
    renderAction();

    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.click(screen.getByRole("button", { name: "Reject save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The save rejection request failed before reaching the server.",
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("clears a previous error when the dialog is reopened", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      mockResponse(false, { error: "Save #1 was already rejected." }, 409),
    );
    renderAction();

    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.click(screen.getByRole("button", { name: "Reject save" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Reject" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
