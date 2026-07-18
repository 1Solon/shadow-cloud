// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

    const dialog = screen.getByRole("dialog", {
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

    screen.getByRole("button", { name: "Background action" }).focus();
    expect(cancel).toHaveFocus();
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
});
