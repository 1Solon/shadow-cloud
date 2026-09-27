// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AutoRefresh } from "@/components/auto-refresh";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

function setVisibility(visibilityState: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

it("refreshes every minute until unmounted", () => {
  vi.useFakeTimers();
  const { unmount } = render(<AutoRefresh />);

  vi.advanceTimersByTime(60_000);
  expect(router.refresh).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(60_000);
  expect(router.refresh).toHaveBeenCalledTimes(2);

  unmount();
  vi.advanceTimersByTime(60_000);
  expect(router.refresh).toHaveBeenCalledTimes(2);
});

it("refreshes as soon as the tab becomes visible again", () => {
  render(<AutoRefresh />);

  setVisibility("hidden");
  expect(router.refresh).not.toHaveBeenCalled();

  setVisibility("visible");
  expect(router.refresh).toHaveBeenCalledTimes(1);
});
