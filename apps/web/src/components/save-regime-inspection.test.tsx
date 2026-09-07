// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SaveRegimeInspection } from "./save-regime-inspection";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it.each(["reset", "undo"])(
  "discards an open %s draft when the save revision changes",
  async (action) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          action === "reset"
            ? {
                fileVersionId: "file",
                sourceId: "source",
                expectedSaveBaseline: "baseline-1",
                regimes: [
                  {
                    id: "north",
                    name: "North Reach",
                    current: true,
                    eligible: true,
                    reason: null,
                  },
                ],
              }
            : {
                undo: {
                  resetId: "reset",
                  outputId: "output",
                  outputRevision: 1,
                  expectedSaveBaseline: "baseline-1",
                  regimeName: "North Reach",
                },
              },
        ),
      ),
    );
    const view = render(
      <SaveRegimeInspection
        gameNumber={1}
        isOverlord
        hasSave
        saveRevision="file:1"
      />,
    );
    if (action === "reset") {
      await userEvent.click(
        screen.getByRole("button", { name: "Inspect regimes" }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Choose North Reach" }),
      );
      await userEvent.type(
        screen.getByLabelText("Replacement password", { exact: true }),
        "StaleDraft",
      );
    } else {
      await userEvent.click(
        screen.getByRole("button", { name: "Check undo availability" }),
      );
      await userEvent.click(
        screen.getByLabelText("Restore the previous password for North Reach."),
      );
    }
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
    view.rerender(
      <SaveRegimeInspection
        gameNumber={1}
        isOverlord
        hasSave
        saveRevision="file:2"
      />,
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Replacement password", { exact: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Choose North Reach" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Inspect regimes" }),
    ).toBeEnabled();
  },
);

it("offers read-only inspection only to the Overlord and explains missing saves", () => {
  const view = render(
    <SaveRegimeInspection gameNumber={1} isOverlord={false} hasSave />,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  view.rerender(
    <SaveRegimeInspection gameNumber={1} isOverlord hasSave={false} />,
  );
  expect(
    screen.getByText("This campaign has no save to inspect."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("shows names, current marker and ineligible explanations without a password control", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    Response.json({
      fileVersionId: "file",
      sourceId: "source",
      regimes: [
        {
          id: "north",
          name: "North Reach",
          current: true,
          eligible: true,
          reason: null,
        },
        {
          id: "south",
          name: "South Reach",
          current: false,
          eligible: false,
          reason: "This regime has no existing password.",
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<SaveRegimeInspection gameNumber={1} isOverlord hasSave />);
  await userEvent.click(
    screen.getByRole("button", { name: "Inspect regimes" }),
  );
  expect(await screen.findByText("North Reach")).toBeInTheDocument();
  expect(screen.getByText("Current regime")).toBeInTheDocument();
  expect(screen.getByText("Eligible for password reset")).toBeInTheDocument();
  expect(
    screen.getByText("This regime has no existing password."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/games/1/save-inspection",
    expect.objectContaining({ cache: "no-store" }),
  );
});
it.each([403, 409, 422, 503])(
  "clears prior inspection and reports an HTTP %s failure",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "Inspect again." }, { status }),
        ),
    );
    render(<SaveRegimeInspection gameNumber={1} isOverlord hasSave />);
    await userEvent.click(
      screen.getByRole("button", { name: "Inspect regimes" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Inspect again.",
    );
  },
);
