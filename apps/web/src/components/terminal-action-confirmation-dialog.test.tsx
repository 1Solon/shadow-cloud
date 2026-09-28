// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalActionConfirmationDialog } from "@/components/terminal-action-confirmation-dialog";

const confirmation = {
  title: "Confirm seat change",
  command: "seat-order --clear seat-2",
  lines: ["Rhea will be removed from seat 2."],
};

describe("TerminalActionConfirmationDialog", () => {
  afterEach(cleanup);

  it("moves focus inside and contains keyboard navigation", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Background action</button>
        <TerminalActionConfirmationDialog
          confirmation={confirmation}
          isPending={false}
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
        />
      </>,
    );

    const dialog = screen.getByRole("alertdialog", {
      name: "Confirm seat change",
    });
    const close = within(dialog).getByRole("button", {
      name: "Close confirmation",
    });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const confirm = within(dialog).getByRole("button", { name: "Confirm" });

    await waitFor(() => expect(cancel).toHaveFocus());
    confirm.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();

    screen
      .getByRole("button", { name: "Background action", hidden: true })
      .focus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("restores focus to the invoking control after dismissal", async () => {
    const user = userEvent.setup();

    function ConfirmationHarness() {
      const [isOpen, setIsOpen] = useState(false);

      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>
            Request action
          </button>
          <TerminalActionConfirmationDialog
            confirmation={isOpen ? confirmation : null}
            isPending={false}
            onCancel={() => setIsOpen(false)}
            onConfirm={vi.fn()}
          />
        </>
      );
    }

    render(<ConfirmationHarness />);
    const trigger = screen.getByRole("button", { name: "Request action" });

    await user.click(trigger);
    await waitFor(() =>
      expect(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Cancel",
        }),
      ).toHaveFocus(),
    );
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("cancels with Escape when no action is pending", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <TerminalActionConfirmationDialog
        confirmation={confirmation}
        isPending={false}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("ignores Escape and outside clicks while an action is pending", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <TerminalActionConfirmationDialog
        confirmation={confirmation}
        isPending
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );

    await user.keyboard("{Escape}");
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    expect(onCancel).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alertdialog", { name: "Confirm seat change" }),
    ).toBeVisible();
  });

  it("types out the command and lines, then shows them in full", async () => {
    render(
      <TerminalActionConfirmationDialog
        confirmation={confirmation}
        isPending={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "Confirm seat change",
    });

    expect(
      within(dialog).queryByText("Rhea will be removed from seat 2."),
    ).toBeNull();
    expect(
      await within(dialog).findByText(
        "> seat-order --clear seat-2",
        {},
        { timeout: 3000 },
      ),
    ).toBeVisible();
    expect(
      await within(dialog).findByText(
        "Rhea will be removed from seat 2.",
        {},
        { timeout: 3000 },
      ),
    ).toBeVisible();
  });
});
