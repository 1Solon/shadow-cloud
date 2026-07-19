// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CampaignConfigurationShell,
  type CampaignConfigurationSection,
} from "@/components/campaign-configuration-shell";

const sections: Array<{
  id: CampaignConfigurationSection;
  label: string;
}> = [
  { id: "identity", label: "Identity & Progress" },
  { id: "world", label: "World Setup" },
  { id: "turn-protocol", label: "Turn Reminders" },
  { id: "seat-order", label: "Seat Order" },
  { id: "notes", label: "Notes" },
];

function Harness({ onExit = vi.fn() }: { onExit?: () => void }) {
  return (
    <CampaignConfigurationShell
      onExit={onExit}
      renderSection={(section, { onDirtyChange }) => (
        <div>
          <span>{`editor:${section}`}</span>
          <button type="button" onClick={() => onDirtyChange(true)}>
            Make dirty
          </button>
          <button type="button" onClick={() => onDirtyChange(false)}>
            Clear dirty
          </button>
        </div>
      )}
    />
  );
}

function StatefulEditor({
  section,
}: {
  section: CampaignConfigurationSection;
}) {
  const [draft, setDraft] = useState("");

  return (
    <label>
      {section} draft
      <input
        aria-label={`${section} draft`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </label>
  );
}

describe("CampaignConfigurationShell", () => {
  afterEach(cleanup);

  it("starts with only the identity editor and a visible identity state label", () => {
    render(<Harness />);

    expect(screen.getByText("editor:identity")).toBeVisible();
    expect(screen.getAllByText(/^editor:/)).toHaveLength(1);
    expect(
      screen.getByText("[CONFIGURING: IDENTITY & PROGRESS]"),
    ).toBeVisible();
  });

  it("uses the standard card heading and description for configuration", () => {
    render(<Harness />);

    const configurationHeading = screen.getByRole("heading", {
      name: "Configure campaign:",
    });
    const region = screen.getByRole("region", {
      name: "Configure campaign:",
    });

    expect(configurationHeading).toBeVisible();
    expect(region).toBeVisible();
    expect(region).toHaveClass(
      "rounded-lg",
      "border-orange-400",
      "bg-black/90",
      "shadow-2xl",
    );
    expect(
      screen.getByText(
        "Update campaign settings, seat order, notes, and turn reminders.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 3, name: "Identity & Progress" }),
    ).toBeVisible();
  });

  it.each(sections)("selects only the $label editor", async ({ id, label }) => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: label }));

    expect(screen.getByText(`editor:${id}`)).toBeVisible();
    expect(screen.getAllByText(/^editor:/)).toHaveLength(1);
    expect(
      screen.getByText(`[CONFIGURING: ${label.toUpperCase()}]`),
    ).toBeVisible();
  });

  it("marks only the active command as the current page", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const nav = screen.getByRole("navigation", {
      name: "Campaign configuration sections",
    });

    expect(
      within(nav).getByRole("button", { name: "Identity & Progress" }),
    ).toHaveAttribute("aria-current", "page");

    await user.click(within(nav).getByRole("button", { name: "Notes" }));

    expect(within(nav).getByRole("button", { name: "Notes" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(nav).getByRole("button", { name: "Identity & Progress" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("does not move focus to the editor heading on initial mount", () => {
    render(<Harness />);

    expect(
      screen.getByRole("heading", { level: 3, name: "Identity & Progress" }),
    ).not.toHaveFocus();
  });

  it("does not move focus to the editor heading during StrictMode initial effect replay", () => {
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Identity & Progress" }),
    ).not.toHaveFocus();
  });

  it("moves focus to the active editor heading after a section switch", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "World Setup" }));

    const heading = screen.getByRole("heading", {
      level: 3,
      name: "World Setup",
    });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(heading).toHaveFocus();
  });

  it("locks other sections and exit while dirty and explains how to continue", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Make dirty" }));

    const commands = sections.map(({ label }) =>
      screen.getByRole("button", { name: label }),
    );
    expect(commands[0]).toBeEnabled();
    for (const command of commands.slice(1)) {
      expect(command).toBeDisabled();
    }
    expect(
      screen.getByRole("button", { name: "Exit configuration" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Save or cancel Identity & Progress before switching sections or leaving configuration.",
    );
  });

  it("reenables navigation and exit after dirty state clears", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Make dirty" }));

    await user.click(screen.getByRole("button", { name: "Clear dirty" }));

    for (const { label } of sections) {
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
    }
    expect(
      screen.getByRole("button", { name: "Exit configuration" }),
    ).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("mounts the next editor clean after a permitted section switch", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Make dirty" }));
    await user.click(screen.getByRole("button", { name: "Clear dirty" }));

    await user.click(screen.getByRole("button", { name: "Seat Order" }));

    expect(screen.getByText("editor:seat-order")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Exit configuration" }),
    ).toBeEnabled();
  });

  it("remounts shared editor component types when the active section changes", async () => {
    const user = userEvent.setup();
    render(
      <CampaignConfigurationShell
        onExit={vi.fn()}
        renderSection={(section) => <StatefulEditor section={section} />}
      />,
    );
    await user.type(
      screen.getByRole("textbox", { name: "identity draft" }),
      "leaked value",
    );

    await user.click(screen.getByRole("button", { name: "World Setup" }));

    expect(screen.getByRole("textbox", { name: "world draft" })).toHaveValue(
      "",
    );
  });

  it("passes a stable dirty-state callback across shell rerenders", async () => {
    const user = userEvent.setup();
    const callbacks: Array<(isDirty: boolean) => void> = [];
    render(
      <CampaignConfigurationShell
        onExit={vi.fn()}
        renderSection={(_section, { onDirtyChange }) => {
          callbacks.push(onDirtyChange);
          return (
            <button type="button" onClick={() => onDirtyChange(true)}>
              Make dirty
            </button>
          );
        }}
      />,
    );
    const initialCallback = callbacks.at(-1);

    await user.click(screen.getByRole("button", { name: "Make dirty" }));

    expect(callbacks.at(-1)).toBe(initialCallback);
  });

  it("invokes exit while clean", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<Harness onExit={onExit} />);

    await user.click(
      screen.getByRole("button", { name: "Exit configuration" }),
    );

    expect(onExit).toHaveBeenCalledOnce();
  });

  it("uses the responsive two-column layout with shrinkable editor content", () => {
    render(<Harness />);

    const layout = screen.getByTestId("campaign-configuration-layout");
    expect(layout).toHaveClass(
      "grid",
      "min-w-0",
      "lg:grid-cols-[minmax(10rem,0.35fr)_minmax(0,1fr)]",
    );
    expect(screen.getByTestId("campaign-configuration-status")).toHaveClass(
      "border-t",
      "border-orange-400/25",
    );
    const exitButton = screen.getByRole("button", {
      name: "Exit configuration",
    });
    expect(exitButton).toHaveClass("h-full");
    expect(exitButton.parentElement).toHaveClass(
      "shrink-0",
      "sm:self-stretch",
    );
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "Identity & Progress",
      }).parentElement,
    ).toHaveClass("min-w-0");
  });
});
