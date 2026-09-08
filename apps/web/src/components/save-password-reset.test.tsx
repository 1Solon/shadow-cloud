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
const regime = {
  id: "target",
  name: "North Reach",
  current: false,
  eligible: true,
  reason: null,
};
const inspection = {
  fileVersionId: "file",
  contentRevision: 1,
  sourceId: "source",
  expectedSaveBaseline: "baseline",
  regimes: [regime],
};
const receipt = {
  resetId: "reset",
  fileVersionId: "file",
  contentRevision: 2,
  regimeName: "North Reach",
  replacedAt: "2026-09-08T10:00:00Z",
};

async function openReset() {
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit Password" }),
  );
}

it("rejects A's repeated receipt for reset B against a newer inspection while the page still shows file:1", async () => {
  let posts = 0;
  const fetchMock = vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      posts += 1;
      return Promise.resolve(Response.json(receipt));
    }
    return Promise.resolve(
      Response.json(
        url.endsWith("save-inspection")
          ? {
              ...inspection,
              contentRevision: posts === 0 ? 1 : 2,
              sourceId: posts === 0 ? "source-A" : "source-B",
              expectedSaveBaseline: posts === 0 ? "baseline-A" : "baseline-B",
            }
          : { undo: null },
      ),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <SaveRegimeInspection
      campaignId="campaign"
      gameNumber={1}
      canManagePasswords
      hasSave
      saveRevision="file:1"
    />,
  );
  for (const attempt of ["A", "B"]) {
    await openReset();
    await userEvent.type(
      screen.getByLabelText("Replacement password"),
      `Secret${attempt}`,
    );
    await userEvent.click(
      screen.getByLabelText(
        "Reset the password for North Reach. I have read the restart warning.",
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Reset password" }),
    );
    if (attempt === "A")
      expect(await screen.findByRole("status")).toHaveTextContent("was reset");
  }
  expect(await screen.findByRole("alert")).toHaveTextContent("Outcome unknown");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(posts).toBe(2);
  expect(
    fetchMock.mock.calls.filter(
      ([, options]) => options?.method === "POST",
    )[1][1]?.body,
  ).toBe(
    JSON.stringify({
      fileVersionId: "file",
      sourceId: "source-B",
      expectedSaveBaseline: "baseline-B",
      regimeId: "target",
      password: "SecretB",
      confirmed: true,
    }),
  );
});

it.each([
  { fileVersionId: "another-file", contentRevision: 2 },
  { fileVersionId: "file", contentRevision: 3 },
])(
  "clears reset success when manual inspection discovers a superseding save (%#)",
  async (superseding) => {
    let latest = { fileVersionId: "file", contentRevision: 1 };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, options?: RequestInit) => {
        if (options?.method === "POST") {
          latest = { fileVersionId: "file", contentRevision: 2 };
          return Promise.resolve(Response.json(receipt));
        }
        return Promise.resolve(
          Response.json(
            url.endsWith("save-inspection")
              ? { ...inspection, ...latest }
              : { undo: null },
          ),
        );
      }),
    );
    render(
      <SaveRegimeInspection
        campaignId="campaign"
        gameNumber={1}
        canManagePasswords
        hasSave
        saveRevision="file:1"
      />,
    );
    await openReset();
    await userEvent.type(
      screen.getByLabelText("Replacement password"),
      "Secret",
    );
    await userEvent.click(
      screen.getByLabelText(
        "Reset the password for North Reach. I have read the restart warning.",
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Reset password" }),
    );
    await screen.findByRole("button", { name: "Edit Password" });
    expect(screen.getByRole("status")).toHaveTextContent("was reset");
    latest = superseding;
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByRole("button", { name: "Edit Password" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  },
);

it("requires explicit target confirmation, reveals only local entry and posts a body-bound reset", async () => {
  let reset = false;
  const fetch = vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "POST") reset = true;
    return Promise.resolve(
      Response.json(
        options?.method === "POST"
          ? receipt
          : url.endsWith("save-inspection")
            ? { ...inspection, contentRevision: reset ? 2 : 1 }
            : { undo: null },
      ),
    );
  });
  vi.stubGlobal("fetch", fetch);
  render(
    <SaveRegimeInspection
      campaignId="campaign"
      gameNumber={1}
      canManagePasswords
      hasSave
      saveRevision="file:1"
    />,
  );
  await openReset();
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
  expect(await screen.findByRole("status")).toHaveTextContent(
    "The in-game password for North Reach was reset.",
  );
  expect(
    screen.queryByLabelText("Replacement password"),
  ).not.toBeInTheDocument();
});
it("Cancel never sends a password and conflicts clear it with an actionable message", async () => {
  const fetch = vi.fn((url: string, options?: RequestInit) =>
    Promise.resolve(
      options?.method === "POST"
        ? Response.json(
            { error: "The save changed. Inspect it again." },
            { status: 409 },
          )
        : Response.json(
            url.endsWith("save-inspection") ? inspection : { undo: null },
          ),
    ),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <SaveRegimeInspection
      campaignId="campaign"
      gameNumber={1}
      canManagePasswords
      hasSave
      saveRevision="file:1"
    />,
  );
  await openReset();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    fetch.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(0);
  await openReset();
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
  expect(
    screen.queryByLabelText("Replacement password"),
  ).not.toBeInTheDocument();
});

it.each([
  { ...receipt, fileVersionId: "another-file" },
  { ...receipt, contentRevision: 1 },
  { ...receipt, regimeName: "Another Regime" },
  { ...receipt, replacedAt: "not-a-date" },
  { ...receipt, replacedAt: "1" },
  { ...receipt, resetId: "" },
])(
  "does not accept an incomplete or uncorrelated reset receipt (%#)",
  async (result) => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, options?: RequestInit) =>
        Promise.resolve(
          Response.json(
            options?.method === "POST"
              ? result
              : url.endsWith("save-inspection")
                ? inspection
                : { undo: null },
          ),
        ),
      ),
    );
    render(
      <SaveRegimeInspection
        campaignId="campaign"
        gameNumber={1}
        canManagePasswords
        hasSave
        saveRevision="file:1"
      />,
    );
    await openReset();
    await userEvent.type(
      screen.getByLabelText("Replacement password"),
      "LocalSecret",
    );
    await userEvent.click(
      screen.getByLabelText(
        "Reset the password for North Reach. I have read the restart warning.",
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Reset password" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /outcome unknown/i,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  },
);

it.each(["lost response", "invalid JSON", "gateway failure"])(
  "keeps %s unknown and only retries read-only recovery until fresh state is available",
  async (failure) => {
    let posts = 0;
    let reads = 0;
    let recoveryReads = 0;
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        posts += 1;
        if (posts > 1)
          return Promise.resolve(
            Response.json({ ...receipt, contentRevision: 3 }),
          );
        if (failure === "lost response")
          return Promise.reject(new Error("disconnected"));
        return Promise.resolve(
          failure === "invalid JSON"
            ? new Response("{")
            : Response.json({ error: "upstream unavailable" }, { status: 502 }),
        );
      }
      if (url.endsWith("save-inspection")) {
        reads += 1;
        return Promise.resolve(
          reads === 2
            ? Response.json(
                { error: "Inspection unavailable" },
                { status: 503 },
              )
            : Response.json({
                ...inspection,
                contentRevision: posts > 1 ? 3 : posts > 0 ? 2 : 1,
                expectedSaveBaseline: `fresh-${reads}`,
              }),
        );
      }
      recoveryReads += 1;
      return Promise.resolve(
        recoveryReads === 2
          ? Response.json({ undo: {} })
          : Response.json({ undo: null }),
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
    await openReset();
    await userEvent.type(
      screen.getByLabelText("Replacement password"),
      "FirstSecret",
    );
    await userEvent.click(
      screen.getByLabelText(
        "Reset the password for North Reach. I have read the restart warning.",
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Reset password" }),
    );
    await screen.findByRole("button", { name: "Retry inspection" });
    expect(screen.getByText(/Outcome unknown/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Edit Password" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Retry recovery" }),
    );
    expect(posts).toBe(1);
    expect(
      screen.queryByRole("button", { name: "Edit Password" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Retry inspection" }),
    );
    await openReset();
    expect(screen.getByLabelText("Replacement password")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Reset password" }),
    ).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText("Replacement password"),
      "SecondSecret",
    );
    await userEvent.click(
      screen.getByLabelText(
        "Reset the password for North Reach. I have read the restart warning.",
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Reset password" }),
    );
    expect(posts).toBe(2);
    expect(
      fetchMock.mock.calls.filter(
        ([, options]) => options?.method === "POST",
      )[1][1]?.body,
    ).toBe(
      JSON.stringify({
        fileVersionId: "file",
        sourceId: "source",
        expectedSaveBaseline: "fresh-3",
        regimeId: "target",
        password: "SecondSecret",
        confirmed: true,
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("was reset");
    view.rerender(
      <SaveRegimeInspection
        campaignId="campaign"
        gameNumber={1}
        canManagePasswords
        hasSave
        saveRevision="file:3"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("was reset");
    view.rerender(
      <SaveRegimeInspection
        campaignId="replacement"
        gameNumber={1}
        canManagePasswords
        hasSave
        saveRevision="file:3"
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  },
);

it.each(["campaign", "number", "save", "permission", "unmount"])(
  "discards a reset body arriving after %s changes and prevents duplicate mutations",
  async (change) => {
    let decode!: (value: unknown) => void;
    const json = vi.fn(
      () =>
        new Promise((resolve) => {
          decode = resolve;
        }),
    );
    const fetchMock = vi.fn((url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? Promise.resolve({ ok: true, status: 200, json })
        : Promise.resolve(
            Response.json(
              url.endsWith("save-inspection") ? inspection : { undo: null },
            ),
          ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const props = {
      campaignId: "campaign",
      gameNumber: 1,
      canManagePasswords: true,
      hasSave: true,
      saveRevision: "file:1",
    };
    const view = render(<SaveRegimeInspection {...props} />);
    await openReset();
    await userEvent.type(
      screen.getByLabelText("Replacement password"),
      "LocalSecret",
    );
    await userEvent.click(
      screen.getByLabelText(
        "Reset the password for North Reach. I have read the restart warning.",
      ),
    );
    const form = screen
      .getByRole("button", { name: "Reset password" })
      .closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(1);
    await waitFor(() => expect(json).toHaveBeenCalledTimes(1));
    if (change === "unmount") view.unmount();
    else
      view.rerender(
        <SaveRegimeInspection
          {...props}
          campaignId={change === "campaign" ? "replacement" : props.campaignId}
          gameNumber={change === "number" ? 2 : 1}
          saveRevision={change === "save" ? "file:2" : props.saveRevision}
          canManagePasswords={change !== "permission"}
        />,
      );
    await act(async () => decode(receipt));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Replacement password"),
    ).not.toBeInTheDocument();
  },
);
