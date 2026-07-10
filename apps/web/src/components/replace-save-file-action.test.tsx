// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReplaceSaveFileAction } from "@/components/replace-save-file-action";

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

function renderAction() {
  return render(
    <ReplaceSaveFileAction
      canonicalFileName="42-T4-S2-Other.se1"
      fileVersionId="version-7"
      gameNumber={42}
      isMostRecent={false}
    />,
  );
}

async function openAndSelectReplacement(
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.click(screen.getByRole("button", { name: "Replace" }));
  await user.upload(
    screen.getByLabelText("Replacement save file"),
    new File(["corrected"], "corrected.se1"),
  );
}

describe("ReplaceSaveFileAction", () => {
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

  it("opens a dialog with the target details and requires a replacement file", async () => {
    const user = userEvent.setup();
    renderAction();

    await user.click(screen.getByRole("button", { name: "Replace" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("42-T4-S2-Other.se1")).toBeInTheDocument();
    expect(screen.getByText(/will not advance the turn/i)).toBeInTheDocument();
    expect(screen.getByText("Maximum file size: 25 MB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace file" })).toBeDisabled();
  });

  it("sends the selected file to the replacement endpoint", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(mockResponse(true));
    renderAction();

    await openAndSelectReplacement(user);
    await user.click(screen.getByRole("button", { name: "Replace file" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/games/42/files/version-7",
      expect.objectContaining({ method: "PUT", body: expect.any(FormData) }),
    );
  });

  it("clears a staged replacement file when cancelled", async () => {
    const user = userEvent.setup();
    renderAction();

    await openAndSelectReplacement(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Replace" }));

    expect(screen.getByRole("button", { name: "Replace file" })).toBeDisabled();
  });

  it("keeps the dialog and selected file when the backend returns an error", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      mockResponse(false, { error: "Replacement denied." }),
    );
    renderAction();

    await openAndSelectReplacement(user);
    await user.click(screen.getByRole("button", { name: "Replace file" }));

    await waitFor(() => {
      expect(screen.getByText("Replacement denied.")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Replace file" }),
      ).toBeEnabled();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("reports a network failure without closing the dialog", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new Error("Network unavailable"));
    renderAction();

    await openAndSelectReplacement(user);
    await user.click(screen.getByRole("button", { name: "Replace file" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "The save replacement request failed before reaching the server.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Replace file" }),
      ).toBeEnabled();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("keeps the selected file available after a conflict", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      mockResponse(false, { error: "The file version has changed." }, 409),
    );
    renderAction();

    await openAndSelectReplacement(user);
    await user.click(screen.getByRole("button", { name: "Replace file" }));

    await waitFor(() => {
      expect(
        screen.getByText("The file version has changed."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Replace file" }),
      ).toBeEnabled();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("prevents duplicate replacement requests while one is pending", async () => {
    const user = userEvent.setup();
    let resolveRequest: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    renderAction();

    await openAndSelectReplacement(user);
    await user.click(screen.getByRole("button", { name: "Replace file" }));

    expect(screen.getByRole("button", { name: "Replace file" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Replace file" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveRequest!(mockResponse(true));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("clears and closes on success, refreshing without replacing the route", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(mockResponse(true));
    renderAction();

    await openAndSelectReplacement(user);
    await user.click(screen.getByRole("button", { name: "Replace file" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });
});
