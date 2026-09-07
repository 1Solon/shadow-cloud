// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
  await userEvent.click(
    screen.getByRole("button", { name: "Check undo availability" }),
  );
  expect(
    await screen.findByText(
      "The previous password for North Reach will be restored. It will not be shown.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Undo password reset" }),
  ).toBeDisabled();
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
    render(<SavePasswordUndo gameNumber={1} onSuccess={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Check undo availability" }),
    );
    if (!status) {
      expect(await screen.findByRole("status")).toHaveTextContent(
        "No password reset is available to undo.",
      );
      return;
    }
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
