// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CampaignReadError from "./error";

const params = vi.hoisted(() => ({ values: [] as string[] }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ getAll: () => params.values }),
}));
afterEach(cleanup);

it.each([
  [
    ["metadata-saved-transfer-failed"],
    "Campaign details saved; Overlord transfer failed.",
  ],
  [
    ["metadata-saved-transfer-unconfirmed"],
    "Campaign details saved; Overlord transfer could not be confirmed.",
  ],
  [["transfer-unconfirmed"], "Overlord transfer could not be confirmed."],
  [["<script>untrusted</script>"], null],
  [["transfer-unconfirmed", "metadata-saved-transfer-failed"], null],
] as const)(
  "keeps read failure passive and never claims ownership was reloaded: %s",
  (values, message) => {
    params.values = [...values];
    render(<CampaignReadError />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Campaign data could not be reloaded.");
    expect(alert).not.toHaveTextContent("ownership has been reloaded");
    expect(alert).not.toHaveTextContent("untrusted");
    if (message) expect(alert).toHaveTextContent(message);
    else expect(alert).not.toHaveTextContent("Overlord transfer");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Reload campaign" }),
    ).toBeEnabled();
  },
);
