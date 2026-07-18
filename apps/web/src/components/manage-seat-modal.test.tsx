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
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ManageSeatModal,
  type ManageSeatModalSeat,
} from "@/components/manage-seat-modal";

const occupiedSeat: ManageSeatModalSeat = {
  id: "seat-2",
  seatNumber: 2,
  playerLabel: "Rhea",
  isActive: false,
  isEmpty: false,
  canClear: true,
  canRemove: false,
  requiresSavedClearBeforeRemove: false,
};

function renderModal(
  seat: ManageSeatModalSeat | null = occupiedSeat,
  overrides: Partial<ComponentProps<typeof ManageSeatModal>> = {},
) {
  const callbacks = {
    onClear: vi.fn(),
    onClose: vi.fn(),
    onMakeActive: vi.fn(),
    onRemove: vi.fn(),
  };

  render(
    <ManageSeatModal
      isPending={false}
      seat={seat}
      {...callbacks}
      {...overrides}
    />,
  );

  return callbacks;
}

describe("ManageSeatModal", () => {
  afterEach(cleanup);

  it("identifies the seat and player without status-label elements", () => {
    renderModal();

    const dialog = screen.getByRole("dialog", { name: "Manage seat 2" });
    expect(within(dialog).getByText("Rhea")).toBeVisible();
    expect(within(dialog).queryByText("Occupied")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Not active")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Active")).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Make active" }),
    ).toBeEnabled();
    expect(
      within(dialog).getByRole("button", { name: "Clear seat" }),
    ).toBeEnabled();
    expect(
      within(dialog).getByRole("button", { name: "Remove seat" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText("Only empty seats can be removed."),
    ).toBeVisible();
  });

  it("shows an open seat without adding an open-status label", () => {
    renderModal({
      ...occupiedSeat,
      id: "seat-3",
      seatNumber: 3,
      playerLabel: "[Open]",
      isEmpty: true,
      canClear: false,
      canRemove: true,
    });

    const dialog = screen.getByRole("dialog", { name: "Manage seat 3" });
    expect(within(dialog).getByText("[Open]")).toBeVisible();
    expect(
      within(dialog).queryByText("Open", { exact: true }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Make active" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText("An empty seat cannot be made active."),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Clear seat" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText("This seat is already empty."),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Remove seat" }),
    ).toBeEnabled();
  });

  it("renders each unavailable reason from explicit seat state", () => {
    const { rerender } = render(
      <ManageSeatModal
        isPending={false}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onMakeActive={vi.fn()}
        onRemove={vi.fn()}
        seat={{ ...occupiedSeat, isActive: true, canClear: false }}
      />,
    );

    expect(screen.getByText("This seat is already active.")).toBeVisible();
    expect(
      screen.getByText("At least one occupied seat must remain."),
    ).toBeVisible();

    rerender(
      <ManageSeatModal
        isPending={false}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onMakeActive={vi.fn()}
        onRemove={vi.fn()}
        seat={{
          ...occupiedSeat,
          playerLabel: "[Open]",
          isEmpty: true,
          canClear: false,
          requiresSavedClearBeforeRemove: true,
        }}
      />,
    );

    expect(
      screen.getByText("Save the cleared seat before removing it."),
    ).toBeVisible();
  });

  it("invokes each enabled action", async () => {
    const user = userEvent.setup();
    const callbacks = renderModal({ ...occupiedSeat, canRemove: true });
    const dialog = screen.getByRole("dialog");

    await user.click(
      within(dialog).getByRole("button", { name: "Make active" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Clear seat" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Remove seat" }),
    );

    expect(callbacks.onMakeActive).toHaveBeenCalledOnce();
    expect(callbacks.onClear).toHaveBeenCalledOnce();
    expect(callbacks.onRemove).toHaveBeenCalledOnce();
  });

  it("contains focus and closes through Escape, the backdrop, and visible controls", async () => {
    const user = userEvent.setup();
    const callbacks = renderModal();
    const dialog = screen.getByRole("dialog");
    const makeActive = within(dialog).getByRole("button", {
      name: "Make active",
    });
    const headerClose = within(dialog).getByRole("button", {
      name: "Close manage seat",
    });
    const footerClose = within(dialog).getByRole("button", { name: "Close" });

    await waitFor(() => expect(makeActive).toHaveFocus());
    footerClose.focus();
    await user.tab();
    expect(headerClose).toHaveFocus();
    await user.tab({ shift: true });
    expect(footerClose).toHaveFocus();

    fireEvent.click(dialog);
    expect(callbacks.onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!);
    expect(callbacks.onClose).toHaveBeenCalledOnce();

    callbacks.onClose.mockClear();
    await user.keyboard("{Escape}");
    expect(callbacks.onClose).toHaveBeenCalledOnce();

    callbacks.onClose.mockClear();
    await user.click(footerClose);
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });
});
