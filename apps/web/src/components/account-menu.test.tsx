// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "@/components/account-menu";

const mocks = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next-auth/react", () => ({ signOut: mocks.signOut }));

async function openMenu(props: {
  canOverride: boolean;
  overrideEnabled: boolean;
}) {
  const user = userEvent.setup();
  render(<AccountMenu name="Rhea" image={null} {...props} />);
  await user.click(screen.getByRole("button", { name: "Account menu" }));
  return user;
}

describe("AccountMenu", () => {
  afterEach(cleanup);

  it("disconnects from the menu", async () => {
    const user = await openMenu({ canOverride: false, overrideEnabled: false });

    expect(
      screen.queryByRole("menuitem", { name: "Enable override" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Disconnect" }));

    expect(mocks.signOut).toHaveBeenCalled();
  });

  it.each([
    [false, "Enable override", "Enable"],
    [true, "Disable override", "Disable"],
  ])(
    "confirms override changes when override is %s",
    async (overrideEnabled, itemName, confirmLabel) => {
      const user = await openMenu({ canOverride: true, overrideEnabled });

      await user.click(screen.getByRole("menuitem", { name: itemName }));

      const confirmation = await screen.findByRole("alertdialog", {
        name: "Confirm override change",
      });
      expect(confirmation).toContainElement(
        screen.getByRole("button", { name: confirmLabel }),
      );

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Account menu" }),
        ).toHaveFocus(),
      );
    },
  );
});
