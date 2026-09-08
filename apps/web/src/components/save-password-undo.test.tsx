// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SaveRegimeInspection } from "./save-regime-inspection";
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockClear();
});
const identity = {
  campaignId: "campaign",
  gameNumber: 1,
  canManagePasswords: true,
  hasSave: true,
  saveRevision: "file:1",
};
const undo = {
  resetId: "reset",
  outputId: "output",
  outputRevision: 1,
  expectedSaveBaseline: "baseline",
  regimeName: "North Reach",
};
const inspection = {
  fileVersionId: "file",
  contentRevision: 1,
  sourceId: "source",
  expectedSaveBaseline: "baseline",
  regimes: [],
};
const receipt = {
  resetId: "reset",
  fileVersionId: "file",
  contentRevision: 2,
  regimeName: "North Reach",
  replacedAt: "2026-09-08T10:00:00Z",
};

async function confirmUndo() {
  await userEvent.click(
    await screen.findByLabelText(
      "Restore the previous password for North Reach.",
    ),
  );
}

it("requires explicit confirmation and posts the recovery baseline, then retains success only for its returned save", async () => {
  let restored = false;
  const fetchMock = vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      restored = true;
      return Promise.resolve(Response.json(receipt));
    }
    return Promise.resolve(
      Response.json(
        url.endsWith("save-inspection")
          ? { ...inspection, contentRevision: restored ? 2 : 1 }
          : { undo: restored ? null : undo },
      ),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<SaveRegimeInspection {...identity} />);
  expect(
    await screen.findByText(
      "The previous password for North Reach will be restored. It will not be shown.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Undo password reset" }),
  ).toBeDisabled();
  await confirmUndo();
  await userEvent.click(
    screen.getByRole("button", { name: "Undo password reset" }),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/games/1/password-reset/undo",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        resetId: "reset",
        outputId: "output",
        outputRevision: 1,
        expectedSaveBaseline: "baseline",
        confirmed: true,
      }),
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "The previous password for North Reach was restored.",
  );
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  view.rerender(<SaveRegimeInspection {...identity} saveRevision="file:2" />);
  expect(screen.getByRole("status")).toHaveTextContent("was restored");
  view.rerender(<SaveRegimeInspection {...identity} saveRevision="file:3" />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it.each([
  { regimeName: "North Reach" },
  { ...receipt, resetId: "another-reset" },
  { ...receipt, fileVersionId: "another-file" },
  { ...receipt, contentRevision: 1 },
  { ...receipt, regimeName: "Another Regime" },
  { ...receipt, replacedAt: null },
])(
  "keeps malformed or uncorrelated undo outcomes unknown even when fresh recovery is available (%#)",
  async (result) => {
    let reads = 0;
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === "POST")
        return Promise.resolve(Response.json(result));
      if (url.endsWith("save-inspection"))
        return Promise.resolve(Response.json(inspection));
      reads += 1;
      return Promise.resolve(
        Response.json({
          undo: { ...undo, expectedSaveBaseline: `baseline-${reads}` },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SaveRegimeInspection {...identity} />);
    await confirmUndo();
    await userEvent.click(
      screen.getByRole("button", { name: "Undo password reset" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /outcome unknown/i,
    );
    await waitFor(() => expect(reads).toBe(2));
    expect(
      screen.getByRole("button", { name: "Undo password reset" }),
    ).toBeDisabled();
    expect(
      screen.getByLabelText("Restore the previous password for North Reach."),
    ).not.toBeChecked();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(1);
  },
);

it.each(["headers", "body"])(
  "ignores obsolete undo %s and guards synchronous duplicate submissions",
  async (phase) => {
    let finish!: (response: Response) => void;
    let decode!: (value: unknown) => void;
    const json = vi.fn(
      () =>
        new Promise((resolve) => {
          decode = resolve;
        }),
    );
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === "POST")
        return phase === "headers"
          ? new Promise<Response>((resolve) => {
              finish = resolve;
            })
          : Promise.resolve({ ok: true, status: 200, json });
      return Promise.resolve(
        Response.json(url.endsWith("save-inspection") ? inspection : { undo }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<SaveRegimeInspection {...identity} />);
    await confirmUndo();
    const form = screen
      .getByRole("button", { name: "Undo password reset" })
      .closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(1);
    if (phase === "body")
      await waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    view.rerender(
      <SaveRegimeInspection {...identity} campaignId="another-campaign" />,
    );
    const obsoleteResponse = Response.json(receipt);
    const obsoleteBody = vi.spyOn(obsoleteResponse, "json");
    await act(async () => {
      if (phase === "headers") finish(obsoleteResponse);
      else decode(receipt);
    });
    expect(obsoleteBody).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      await screen.findByLabelText(
        "Restore the previous password for North Reach.",
      ),
    ).not.toBeChecked();
  },
);

it("retries failed recovery reads without posting, and treats undo rejection separately from unknown", async () => {
  let recoveryReads = 0;
  const fetchMock = vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "POST")
      return Promise.resolve(
        Response.json({ error: "Refresh recovery." }, { status: 409 }),
      );
    if (url.endsWith("save-inspection"))
      return Promise.resolve(Response.json(inspection));
    recoveryReads += 1;
    return Promise.resolve(
      recoveryReads === 1
        ? Response.json({ error: "Unavailable" }, { status: 503 })
        : Response.json({ undo: recoveryReads === 2 ? undo : null }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<SaveRegimeInspection {...identity} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Retry recovery" }),
  );
  await confirmUndo();
  await userEvent.click(
    screen.getByRole("button", { name: "Undo password reset" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Refresh recovery.",
  );
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

it("ignores obsolete recovery reads and aborts active reads on unmount", async () => {
  let first!: (response: Response) => void;
  let currentRecoveryReads = 0;
  const signals: (AbortSignal | null | undefined)[] = [];
  const fetchMock = vi.fn((url: string, options?: RequestInit) => {
    signals.push(options?.signal);
    if (url.endsWith("save-inspection"))
      return Promise.resolve(Response.json(inspection));
    if (url.includes("/1/"))
      return new Promise<Response>((resolve) => {
        first = resolve;
      });
    currentRecoveryReads += 1;
    if (currentRecoveryReads > 1) return new Promise<Response>(() => undefined);
    return Promise.resolve(Response.json({ undo }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<SaveRegimeInspection {...identity} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  view.rerender(<SaveRegimeInspection {...identity} gameNumber={2} />);
  await screen.findByLabelText(
    "Restore the previous password for North Reach.",
  );
  await act(async () =>
    first(Response.json({ undo: { ...undo, regimeName: "Stale Regime" } })),
  );
  expect(screen.queryByText(/Stale Regime/)).not.toBeInTheDocument();
  expect(signals[1]?.aborted).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
  view.unmount();
  expect(signals.at(-1)?.aborted).toBe(true);
  expect(refresh).not.toHaveBeenCalled();
});
