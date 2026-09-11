// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createDevelopmentCompanion } from "../development/companion";
import { useCompanion } from "./useCompanion";

afterEach(cleanup);

it("subscribes before reading state and never replaces a newer revision with an older response", async () => {
  const companion = createDevelopmentCompanion("active");
  const initial = await companion.snapshot();
  let resolveSnapshot: (snapshot: typeof initial) => void = () => {};
  companion.snapshot = () =>
    new Promise((resolve) => {
      resolveSnapshot = resolve;
    });
  const { result, unmount } = renderHook(() => useCompanion(companion));
  await act(async () => {
    await companion.command({ type: "set-paused", paused: true });
  });
  await waitFor(() => expect(result.current.snapshot?.paused).toBe(true));
  await act(async () => resolveSnapshot(initial));
  expect(result.current.snapshot?.paused).toBe(true);
  unmount();
});

it("cleans up a subscription that finishes opening after the window unmounts", async () => {
  const companion = createDevelopmentCompanion("active");
  let finishOpening: (stop: () => void) => void = () => {};
  let closed = false;
  companion.subscribe = () =>
    new Promise((resolve) => {
      finishOpening = resolve;
    });
  const { unmount } = renderHook(() => useCompanion(companion));
  unmount();
  await act(async () =>
    finishOpening(() => {
      closed = true;
    }),
  );
  expect(closed).toBe(true);
});
