// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CampaignListError from "./error";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("retries loading campaigns every minute and on request", () => {
  vi.useFakeTimers();
  const retry = vi.fn();
  render(<CampaignListError retry={retry} />);

  expect(screen.getByRole("alert")).toHaveTextContent(
    "Campaigns could not be loaded.",
  );
  expect(retry).not.toHaveBeenCalled();

  act(() => vi.advanceTimersByTime(60_000));
  expect(retry).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
  expect(retry).toHaveBeenCalledTimes(2);
});
