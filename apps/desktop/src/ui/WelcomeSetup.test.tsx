// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDevelopmentCompanion } from "../development/companion";
import { App } from "./App";
import { WELCOME_SETUP_DURATION_MS } from "./welcomeSetupTransition";

// Exercise the real scene, camera, transition and engine boundary without a GPU.
vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    setClearAlpha() {}
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  },
}));

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let reducedMotion = false;

beforeEach(() => {
  reducedMotion = false;
  frames.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.stubGlobal("WebGLRenderingContext", class {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reducedMotion;
    },
  }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(883);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(594);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountWelcome() {
  const companion = createDevelopmentCompanion("onboarding");
  const command = vi.spyOn(companion, "command");
  const view = render(<App companion={companion} development />);
  await act(async () => {
    await Promise.resolve();
  });
  return { companion, command, view };
}

async function advanceFrame(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(performance.now());
  });
}

it("frames the lower cone, zooms into it, then advances setup exactly once", async () => {
  const { companion, command } = await mountWelcome();
  const button = screen.getByRole("button", { name: "BEGIN SETUP" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(command).not.toHaveBeenCalled();
  expect((await companion.snapshot()).onboarding.stage).toBe("welcome");

  await advanceFrame(350);
  const box = document.querySelector(".welcome-target-frame rect");
  expect(box).not.toBeNull();
  const framedHeight = Number(box?.getAttribute("height"));
  expect(framedHeight).toBeGreaterThan(20);
  expect(framedHeight).toBeLessThan(120);

  await advanceFrame(900);
  expect(Number(box?.getAttribute("height"))).toBeGreaterThan(framedHeight * 2);
  expect(command).not.toHaveBeenCalled();

  await advanceFrame(WELCOME_SETUP_DURATION_MS - 1250);
  expect(command).toHaveBeenCalledExactlyOnceWith({
    type: "continue-onboarding",
  });
  expect(
    screen.getByRole("heading", { name: /CONNECT THIS DEVICE/ }),
  ).toHaveFocus();
  expect((await companion.snapshot()).onboarding.canSend).toBe(false);
  expect(document.querySelector(".welcome-node-field")).toBeNull();
});

it("skips the zoom when reduced motion is requested", async () => {
  reducedMotion = true;
  const { command } = await mountWelcome();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "BEGIN SETUP" }));
  });
  expect(command).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("heading", { name: /CONNECT THIS DEVICE/ }),
  ).toBeVisible();
});

it("does not send a navigation command after the welcome view is unmounted", async () => {
  const { command, view } = await mountWelcome();
  fireEvent.click(screen.getByRole("button", { name: "BEGIN SETUP" }));
  await act(async () => {
    view.unmount();
  });
  await advanceFrame(WELCOME_SETUP_DURATION_MS + 500);
  expect(command).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("restores the welcome screen so a failed engine command can be retried", async () => {
  const { command } = await mountWelcome();
  command.mockRejectedValueOnce("storage-unavailable");
  fireEvent.click(screen.getByRole("button", { name: "BEGIN SETUP" }));
  await advanceFrame(WELCOME_SETUP_DURATION_MS);
  expect(screen.getByRole("alert")).toHaveTextContent("could not save");
  expect(screen.getByRole("button", { name: "BEGIN SETUP" })).toBeEnabled();
  expect(
    document.querySelector<HTMLElement>(".welcome-node-field")?.style.opacity,
  ).toBe("");

  fireEvent.click(screen.getByRole("button", { name: "BEGIN SETUP" }));
  await advanceFrame(WELCOME_SETUP_DURATION_MS);
  expect(command).toHaveBeenCalledTimes(2);
  expect(
    screen.getByRole("heading", { name: /CONNECT THIS DEVICE/ }),
  ).toBeVisible();
});

it("still opens setup if animation frames stop arriving", async () => {
  const { command } = await mountWelcome();
  fireEvent.click(screen.getByRole("button", { name: "BEGIN SETUP" }));
  await act(async () => {
    vi.advanceTimersByTime(WELCOME_SETUP_DURATION_MS + 500);
  });
  expect(command).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("heading", { name: /CONNECT THIS DEVICE/ }),
  ).toBeVisible();
});

it("continues safely if the graphics context is lost during the zoom", async () => {
  const { command, view } = await mountWelcome();
  const scheduled = vi.spyOn(window, "setTimeout");
  const cancelled = vi.spyOn(window, "clearTimeout");
  fireEvent.click(screen.getByRole("button", { name: "BEGIN SETUP" }));
  const fallbackIndex = scheduled.mock.calls.findIndex(
    ([, delay]) => delay === WELCOME_SETUP_DURATION_MS + 350,
  );
  expect(fallbackIndex).toBeGreaterThanOrEqual(0);
  await advanceFrame(800);
  const welcomeFrames = [...frames.keys()];
  await act(async () => {
    document
      .querySelector("canvas")
      ?.dispatchEvent(new Event("webglcontextlost"));
  });
  expect(command).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("heading", { name: /CONNECT THIS DEVICE/ }),
  ).toBeVisible();
  expect(cancelled).toHaveBeenCalledWith(
    scheduled.mock.results[fallbackIndex].value,
  );
  // The flat Connect diagram needs no animation frames of its own.
  expect(welcomeFrames.every((id) => !frames.has(id))).toBe(true);
  expect(frames.size).toBe(0);
  await advanceFrame(WELCOME_SETUP_DURATION_MS + 500);
  expect(command).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(frames.size).toBe(0);
});
