// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsNewDialog } from "@/components/whats-new-dialog";

vi.mock("ascii.rest/react", () => ({
  Ascii: ({ label }: { label: string }) => (
    <pre role="img" aria-label={label} />
  ),
}));

const releases = [
  {
    name: "0.19.0",
    publishedAt: "2026-09-28T22:46:03Z",
    body: "## Added\n\n- Save rejection.",
  },
  {
    name: "0.18.0",
    publishedAt: "2026-09-28T21:22:10Z",
    body: "- Seat order editing.",
  },
];

describe("WhatsNewDialog", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("shows release notes when opened", async () => {
    const user = userEvent.setup();
    render(<WhatsNewDialog label="VERSION: v0.19.0" releases={releases} />);

    await user.click(screen.getByRole("button", { name: /^VERSION: v0.19.0/ }));

    const dialog = screen.getByRole("dialog", { name: "What's new" });
    expect(
      within(dialog).getByRole("heading", { name: "0.19.0" }),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByText("2026-09-28")).toHaveLength(2);
    expect(within(dialog).getByText("Save rejection.")).toBeInTheDocument();
    expect(within(dialog).getByText("Seat order editing.")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: "All releases on GitHub" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/1Solon/shadow-cloud/releases",
    );

    await user.click(
      within(dialog).getByRole("button", { name: "Close what's new" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("scrambles to a patch notes prompt until the notes are opened", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("shadow-cloud:last-seen-release", "0.18.0");
    render(<WhatsNewDialog label="VERSION: v0.19.0" releases={releases} />);

    const button = screen.getByRole("button", {
      name: "VERSION: v0.19.0, new patch notes",
    });
    expect(
      within(button).getByRole("img", {
        name: "VERSION: v0.19.0, click for patch notes",
      }),
    ).toBeInTheDocument();
    expect(button).toHaveClass("patch-notes-flash");

    await user.click(button);

    expect(button).toHaveAccessibleName("VERSION: v0.19.0");
    expect(button).not.toHaveClass("patch-notes-flash");
    expect(within(button).queryByRole("img")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("shadow-cloud:last-seen-release")).toBe(
      "0.19.0",
    );
  });

  it("shows the plain version for a release that has been seen", () => {
    window.localStorage.setItem("shadow-cloud:last-seen-release", "0.19.0");
    render(<WhatsNewDialog label="VERSION: v0.19.0" releases={releases} />);

    const button = screen.getByRole("button", { name: "VERSION: v0.19.0" });
    expect(button).toHaveTextContent("VERSION: v0.19.0");
    expect(within(button).queryByRole("img")).not.toBeInTheDocument();
  });

  it("explains when release notes are unavailable", async () => {
    const user = userEvent.setup();
    render(<WhatsNewDialog label="VERSION: v0.19.0" releases={[]} />);

    const button = screen.getByRole("button", { name: "VERSION: v0.19.0" });
    expect(within(button).queryByRole("img")).not.toBeInTheDocument();

    await user.click(button);

    expect(
      screen.getByText("Release notes could not be loaded."),
    ).toBeInTheDocument();
  });
});
