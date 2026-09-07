// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SavePasswordReset } from "./save-password-reset";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const regime = {
  id: "target",
  name: "North Reach",
  current: false,
  eligible: true,
  reason: null,
};
const inspection = {
  fileVersionId: "file",
  sourceId: "source",
  expectedSaveBaseline: "baseline",
  regimes: [regime],
};
it("requires explicit target confirmation, reveals only local entry and posts a body-bound reset", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ regimeName: "North Reach" }));
  vi.stubGlobal("fetch", fetch);
  const success = vi.fn();
  render(
    <SavePasswordReset
      gameNumber={1}
      inspection={inspection}
      regime={regime}
      onCancel={vi.fn()}
      onSuccess={success}
    />,
  );
  expect(screen.getByText("Players must use the updated save")).toBeVisible();
  expect(
    screen.getByText(
      "This changes the password in Shadow Cloud's latest save only. Copies already downloaded will not be updated.",
    ),
  ).toBeVisible();
  expect(
    screen.getByText(
      "If the current player has started their turn, ask them to stop and restart that turn from the updated save. Uploading a turn played from the old copy could undo this password reset.",
    ),
  ).toBeVisible();
  expect(
    screen.getByText("This action does not advance the campaign's turn."),
  ).toBeVisible();
  await userEvent.type(
    screen.getByLabelText("Replacement password"),
    "LocalSecret",
  );
  expect(screen.getByRole("button", { name: "Reset password" })).toBeDisabled();
  await userEvent.click(screen.getByLabelText("Reveal replacement password"));
  expect(
    screen.getByRole("textbox", { name: "Replacement password" }),
  ).toHaveValue("LocalSecret");
  await userEvent.click(
    screen.getByLabelText(
      "Reset the password for North Reach. I have read the restart warning.",
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
  expect(fetch).toHaveBeenCalledWith(
    "/api/games/1/password-reset",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        fileVersionId: "file",
        sourceId: "source",
        expectedSaveBaseline: "baseline",
        regimeId: "target",
        password: "LocalSecret",
        confirmed: true,
      }),
    }),
  );
  expect(success).toHaveBeenCalledWith("North Reach");
  expect(screen.getByLabelText("Replacement password")).toHaveValue("");
});
it("Cancel never sends a password and conflicts clear it with an actionable message", async () => {
  const cancel = vi.fn();
  const fetch = vi
    .fn()
    .mockResolvedValue(
      Response.json(
        { error: "The save changed. Inspect it again." },
        { status: 409 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  render(
    <SavePasswordReset
      gameNumber={1}
      inspection={inspection}
      regime={regime}
      onCancel={cancel}
      onSuccess={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(cancel).toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  await userEvent.type(
    screen.getByLabelText("Replacement password"),
    "LocalSecret",
  );
  await userEvent.click(
    screen.getByLabelText(
      "Reset the password for North Reach. I have read the restart warning.",
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The save changed. Inspect it again.",
  );
  expect(screen.getByLabelText("Replacement password")).toHaveValue("");
});
