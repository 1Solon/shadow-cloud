// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SavePasswordUndo } from "./save-password-undo";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const undo = {
  resetId: "reset",
  outputId: "output",
  outputRevision: 1,
  expectedSaveBaseline: "baseline",
  regimeName: "North Reach",
};
it("shows availability and requires explicit confirmation that the previous password returns", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ undo }))
    .mockResolvedValueOnce(Response.json({ regimeName: "North Reach" }));
  vi.stubGlobal("fetch", fetch);
  const onSuccess = vi.fn();
  render(<SavePasswordUndo gameNumber={1} onSuccess={onSuccess} />);
  expect(
    await screen.findByText(
      "The previous password for North Reach will be restored. It will not be shown.",
    ),
  ).toBeVisible();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Undo password reset" }),
    ).toBeDisabled(),
  );
  await userEvent.click(
    screen.getByLabelText("Restore the previous password for North Reach."),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Undo password reset" }),
  );
  expect(fetch).toHaveBeenLastCalledWith(
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
  expect(onSuccess).toHaveBeenCalledWith("North Reach");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

it("does not refetch or reset availability while undo is pending", async () => {
  let resolvePost!: (response: Response) => void;
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ undo }))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolvePost = resolve;
        }),
    )
    .mockResolvedValueOnce(Response.json({ undo: null }));
  vi.stubGlobal("fetch", fetch);
  const onSuccess = vi.fn();
  const view = render(
    <SavePasswordUndo gameNumber={1} onSuccess={onSuccess} />,
  );
  await screen.findByLabelText(
    "Restore the previous password for North Reach.",
  );
  await userEvent.click(
    screen.getByLabelText("Restore the previous password for North Reach."),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Undo password reset" }),
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

  view.rerender(<SavePasswordUndo gameNumber={2} onSuccess={onSuccess} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(
    screen.getByText(
      "The previous password for North Reach will be restored. It will not be shown.",
    ),
  ).toBeVisible();
  expect(
    screen.getByLabelText("Restore the previous password for North Reach."),
  ).toBeDisabled();

  resolvePost(Response.json({ regimeName: "North Reach" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/games/2/password-reset",
    expect.objectContaining({ cache: "no-store" }),
  );
  expect(onSuccess).not.toHaveBeenCalled();
});

it.each([null, 409, 503])(
  "shows unavailable or failed undo without exposing a password (%#)",
  async (status) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ undo: status ? undo : null }))
      .mockResolvedValueOnce(
        Response.json(
          { error: "Refresh recovery." },
          { status: status ?? 409 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const view = render(
      <SavePasswordUndo gameNumber={1} onSuccess={vi.fn()} />,
    );
    if (!status) {
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(view.container).toBeEmptyDOMElement());
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      return;
    }
    expect(
      await screen.findByText(
        "The previous password for North Reach will be restored. It will not be shown.",
      ),
    ).toBeVisible();
    await userEvent.click(
      screen.getByLabelText("Restore the previous password for North Reach."),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Undo password reset" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Refresh recovery.",
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  },
);

it("ignores an availability response for a previous game number", async () => {
  let resolveFirst!: (response: Response) => void;
  let resolveSecond!: (response: Response) => void;
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveSecond = resolve;
        }),
    );
  vi.stubGlobal("fetch", fetch);
  const view = render(<SavePasswordUndo gameNumber={1} onSuccess={vi.fn()} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  view.rerender(<SavePasswordUndo gameNumber={2} onSuccess={vi.fn()} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

  resolveSecond(Response.json({ undo }));
  expect(
    await screen.findByText(
      "The previous password for North Reach will be restored. It will not be shown.",
    ),
  ).toBeVisible();
  resolveFirst(
    Response.json({
      undo: { ...undo, regimeName: "Stale Regime" },
    }),
  );
  await waitFor(() =>
    expect(screen.queryByText(/Stale Regime/)).not.toBeInTheDocument(),
  );
});

it("aborts an availability lookup when it unmounts", async () => {
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, options?: RequestInit) => {
      signal = options?.signal;
      return new Promise<Response>(() => undefined);
    }),
  );
  const view = render(<SavePasswordUndo gameNumber={1} onSuccess={vi.fn()} />);
  await waitFor(() => expect(signal).toBeDefined());
  view.unmount();
  expect(signal?.aborted).toBe(true);
});
