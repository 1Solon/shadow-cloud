// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SaveRegimeInspection } from "./save-regime-inspection";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

it("treats a malformed reset receipt as unknown and requires fresh reads and confirmation", async () => {
  let inspections = 0;
  let recoveries = 0;
  const fetchMock = vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "POST")
      return Promise.resolve(Response.json({ regimeName: "North Reach" }));
    if (url.endsWith("save-inspection")) {
      inspections += 1;
      return Promise.resolve(
        Response.json({
          fileVersionId: "file",
          contentRevision: inspections > 1 ? 2 : 1,
          sourceId: "source",
          expectedSaveBaseline: `baseline-${inspections}`,
          regimes: [
            {
              id: "north",
              name: "North Reach",
              current: true,
              eligible: true,
              reason: null,
            },
          ],
        }),
      );
    }
    recoveries += 1;
    return Promise.resolve(
      Response.json({
        undo:
          recoveries > 1
            ? {
                resetId: "reset",
                outputId: "output",
                outputRevision: 2,
                expectedSaveBaseline: "fresh-recovery",
                regimeName: "North Reach",
              }
            : null,
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const view = render(
    <SaveRegimeInspection
      campaignId="campaign"
      gameNumber={1}
      canManagePasswords
      hasSave
      saveRevision="file:1"
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit Password" }),
  );
  await userEvent.type(
    screen.getByLabelText("Replacement password", { exact: true }),
    "LocalSecret",
  );
  await userEvent.click(
    screen.getByLabelText(
      "Reset the password for North Reach. I have read the restart warning.",
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /outcome unknown/i,
  );
  await waitFor(() => expect(inspections).toBe(2));
  expect(recoveries).toBeGreaterThan(1);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("Replacement password", { exact: true }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Undo password reset" }),
  ).toBeDisabled();
  view.rerender(
    <SaveRegimeInspection
      campaignId="campaign"
      gameNumber={1}
      canManagePasswords
      hasSave
      saveRevision="file:2"
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/outcome unknown/i);
  await screen.findByRole("button", { name: "Edit Password" });
  await userEvent.click(screen.getByRole("button", { name: "Edit Password" }));
  expect(
    screen.getByLabelText("Replacement password", { exact: true }),
  ).toHaveValue("");
  expect(screen.getByRole("button", { name: "Reset password" })).toBeDisabled();
  expect(
    fetchMock.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(1);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("uses the shared campaign card framing and heading styles", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  render(
    <SaveRegimeInspection
      campaignId="campaign"
      gameNumber={1}
      canManagePasswords
      hasSave={false}
    />,
  );
  expect(
    screen.getByRole("region", { name: "In-game regime inspection" }),
  ).toHaveClass(
    "rounded-lg",
    "border-orange-400",
    "bg-black/90",
    "shadow-orange-400/20",
  );
  expect(screen.getByRole("heading", { name: "Passwords:" })).toHaveClass(
    "text-xl",
    "font-semibold",
  );
  expect(
    screen.getByText("This campaign has no save to inspect."),
  ).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each(["reset", "undo"])(
  "discards an open %s draft when the save revision changes",
  async (action) => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          Response.json(
            url.includes("save-inspection")
              ? {
                  fileVersionId: "file",
                  contentRevision: 1,
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
                  undo:
                    action === "undo"
                      ? {
                          resetId: "reset",
                          outputId: "output",
                          outputRevision: 1,
                          expectedSaveBaseline: "baseline-1",
                          regimeName: "North Reach",
                        }
                      : null,
                },
          ),
        ),
      ),
    );
    const view = render(
      <SaveRegimeInspection
        campaignId="campaign"
        gameNumber={1}
        canManagePasswords
        hasSave
        saveRevision="file:1"
      />,
    );
    if (action === "reset") {
      await userEvent.click(
        await screen.findByRole("button", { name: "Edit Password" }),
      );
      await userEvent.type(
        screen.getByLabelText("Replacement password", { exact: true }),
        "StaleDraft",
      );
    } else {
      await screen.findByLabelText(
        "Restore the previous password for North Reach.",
      );
      await userEvent.click(
        screen.getByLabelText("Restore the previous password for North Reach."),
      );
    }
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
    view.rerender(
      <SaveRegimeInspection
        campaignId="campaign"
        gameNumber={1}
        canManagePasswords
        hasSave
        saveRevision="file:2"
      />,
    );
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Replacement password", { exact: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit Password" }),
    ).not.toBeInTheDocument();
    if (action === "reset") {
      expect(
        await screen.findByRole("button", { name: "Edit Password" }),
      ).toBeVisible();
    } else {
      expect(
        await screen.findByRole("button", { name: "Refresh" }),
      ).toBeEnabled();
    }
  },
);

it("offers read-only inspection only to the Overlord and explains missing saves", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const view = render(
    <SaveRegimeInspection
      campaignId="campaign"
      gameNumber={1}
      canManagePasswords={false}
      hasSave
    />,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  view.rerender(
    <SaveRegimeInspection
      campaignId="campaign"
      gameNumber={1}
      canManagePasswords
      hasSave={false}
    />,
  );
  expect(
    screen.getByText("This campaign has no save to inspect."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("shows names, current marker and ineligible explanations without a password control", async () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      Response.json({
        fileVersionId: "file",
        contentRevision: 1,
        sourceId: "source",
        expectedSaveBaseline: "baseline",
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
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <SaveRegimeInspection
      campaignId="campaign"
      gameNumber={1}
      canManagePasswords
      hasSave
    />,
  );
  expect(
    await screen.findByRole("button", { name: "Edit Password" }),
  ).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "Refresh" })).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "Inspect regimes" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("North Reach", { exact: true })).toBeInTheDocument();
  expect(screen.getByText("South Reach")).toBeInTheDocument();
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
      vi.fn((url: string) =>
        Promise.resolve(
          url.includes("password-reset")
            ? Response.json({ undo: null })
            : Response.json({ error: "Inspect again." }, { status }),
        ),
      ),
    );
    render(
      <SaveRegimeInspection
        campaignId="campaign"
        gameNumber={1}
        canManagePasswords
        hasSave
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Inspect again.",
    );
    expect(
      await screen.findByRole("button", { name: "Retry inspection" }),
    ).toBeEnabled();
  },
);

it.each(["save-inspection", "password-reset"])(
  "ignores an obsolete decoded %s read after the authoritative save changes",
  async (path) => {
    let decode!: (value: unknown) => void;
    let first = true;
    const json = vi.fn(
      () =>
        new Promise((resolve) => {
          decode = resolve;
        }),
    );
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith(path) && first) {
        first = false;
        return Promise.resolve({ ok: true, status: 200, json });
      }
      return Promise.resolve(
        Response.json(
          url.endsWith("save-inspection")
            ? {
                fileVersionId: "file",
                contentRevision: 2,
                sourceId: "source",
                expectedSaveBaseline: "fresh",
                regimes: [],
              }
            : { undo: null },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const props = {
      campaignId: "campaign",
      gameNumber: 1,
      hasSave: true,
      canManagePasswords: true,
      saveRevision: "file:1",
    };
    const view = render(<SaveRegimeInspection {...props} />);
    await waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    view.rerender(<SaveRegimeInspection {...props} saveRevision="file:2" />);
    await act(async () =>
      decode(
        path === "save-inspection"
          ? {
              fileVersionId: "file",
              contentRevision: 1,
              sourceId: "stale",
              expectedSaveBaseline: "stale",
              regimes: [
                {
                  id: "old",
                  name: "Stale Regime",
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
                expectedSaveBaseline: "stale",
                regimeName: "Stale Regime",
              },
            },
      ),
    );
    await screen.findByText("No human-controlled regimes were found.");
    expect(screen.queryByText(/Stale Regime/)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit Password" }),
    ).not.toBeInTheDocument();
  },
);
