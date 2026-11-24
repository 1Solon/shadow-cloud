// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { PasswordResetApproval } from "@/lib/shadow-cloud-api";
import { SaveRegimeInspection } from "./save-regime-inspection";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockClear();
});

const approval: PasswordResetApproval = {
  id: "approval",
  state: "OPEN",
  regimeId: "north",
  regimeName: "North Reach",
  playerId: "player",
  playerDisplayName: "Kaz",
  approverDisplayName: "Vera",
  approverRole: "overlord",
  reason: null,
  grantedAt: "2026-09-08T10:00:00.000Z",
};
const inspection = {
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
      eligible: true,
      reason: null,
    },
  ],
};

function stubFetch(post: unknown = { approvalId: "approval" }) {
  const fetchMock = vi.fn((url: string, options?: RequestInit) =>
    Promise.resolve(
      Response.json(
        options?.method === "POST"
          ? post
          : url.endsWith("save-inspection")
            ? inspection
            : { undo: null },
      ),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function posts(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls
    .filter(([, options]) => options?.method === "POST")
    .map(([url, options]) => [url, JSON.parse(String(options?.body))]);
}

const overlord = {
  campaignId: "campaign",
  gameNumber: 1,
  canManagePasswords: true,
  hasSave: true,
  saveRevision: "file:1",
  saveBaseline: "baseline",
  currentUserId: "overlord",
  activePlayer: { userId: "player", displayName: "Kaz" },
};
const player = {
  ...overlord,
  canManagePasswords: false,
  currentUserId: "player",
  canSetApprovedPassword: true,
};

it("lets the Overlord let the active player set the waiting regime's password", async () => {
  const fetchMock = stubFetch();
  render(<SaveRegimeInspection {...overlord} approval={null} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Let Kaz set it" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(posts(fetchMock)).toEqual([
    [
      "/api/games/1/password-reset-approval",
      {
        fileVersionId: "file",
        sourceId: "source",
        expectedSaveBaseline: "baseline",
      },
    ],
  ]);
});

it("shows the Overlord an open approval with Withdraw and no direct reset for that regime", async () => {
  const fetchMock = stubFetch();
  render(<SaveRegimeInspection {...overlord} approval={approval} />);
  const panel = await screen.findByRole("region", {
    name: "Password reset approval",
  });
  expect(panel).toHaveTextContent("Kaz");
  expect(panel).toHaveTextContent("North Reach");
  expect(panel).toHaveTextContent("Approved by Vera");
  expect(
    await screen.findAllByRole("button", { name: "Edit Password" }),
  ).toHaveLength(1);
  expect(
    screen.queryByRole("button", { name: "Let Kaz set it" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Withdraw" }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(posts(fetchMock)).toEqual([
    [
      "/api/games/1/password-reset-approval/withdraw",
      { approvalId: "approval" },
    ],
  ]);
});

it("shows the active player only the waiting regime's Set password control while an approval is open", async () => {
  const fetchMock = stubFetch({
    resetId: "reset",
    fileVersionId: "file",
    contentRevision: 2,
    regimeName: "North Reach",
    replacedAt: "2026-09-08T10:05:00Z",
  });
  render(<SaveRegimeInspection {...player} approval={approval} />);
  expect(screen.getByText("North Reach")).toBeInTheDocument();
  expect(screen.queryByText("South Reach")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Edit Password" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Set password" }));
  await userEvent.type(
    screen.getByLabelText("Replacement password"),
    "PlayerSecret",
  );
  await userEvent.click(
    screen.getByLabelText(
      "Reset the password for North Reach. I have read the restart warning.",
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "You set a new in-game password for North Reach.",
  );
  expect(posts(fetchMock)).toEqual([
    [
      "/api/games/1/password-reset-approval/use",
      {
        approvalId: "approval",
        expectedSaveBaseline: "baseline",
        password: "PlayerSecret",
        confirmed: true,
      },
    ],
  ]);
  expect(
    fetchMock.mock.calls.some(([url]) => url.endsWith("save-inspection")),
  ).toBe(false);
});

it.each([
  ["no approval", null, true],
  ["no permission to use it", approval, false],
] as const)(
  "shows the active player nothing with %s",
  (_label, current, canSetApprovedPassword) => {
    stubFetch();
    const { container } = render(
      <SaveRegimeInspection
        {...player}
        approval={current}
        canSetApprovedPassword={canSetApprovedPassword}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  },
);
