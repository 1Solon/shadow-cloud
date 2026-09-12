// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Camera, Scene } from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReviewGraphic } from "./ReviewGraphic";

const gpu = vi.hoisted(() => ({
  render: vi.fn<(scene: Scene, camera: Camera) => void>(),
  dispose: vi.fn(),
}));
vi.mock("three", async (importOriginal) => ({
  ...(await importOriginal<typeof import("three")>()),
  WebGLRenderer: class {
    domElement = document.createElement("canvas");
    setClearAlpha() {}
    setPixelRatio() {}
    setSize() {}
    render = gpu.render;
    dispose = gpu.dispose;
  },
}));

const frames = new Map<number, FrameRequestCallback>();
const motionListeners = new Set<() => void>();
let nextFrame = 0;
let reducedMotion = false;

beforeEach(() => {
  vi.clearAllMocks();
  reducedMotion = false;
  frames.clear();
  motionListeners.clear();
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
    addEventListener: (_: string, listener: () => void) =>
      motionListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      motionListeners.delete(listener),
  }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(380);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(523);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function advanceFrame(time: number) {
  const callbacks = [...frames.values()];
  frames.clear();
  for (const callback of callbacks) callback(time);
}

it("renders the active station and stops its animation and resources on unmount", () => {
  const view = render(<ReviewGraphic />);
  expect(screen.getByRole("img")).toHaveAccessibleName(
    "Active space station with illuminated habitats and docking traffic",
  );
  const scene = gpu.render.mock.calls[0][0];
  const craft = scene.getObjectByName("docking-craft-0");
  if (!craft)
    throw new Error("The active station must contain docking traffic");
  const initialPosition = craft.position.clone();
  advanceFrame(0);
  advanceFrame(50);
  expect(craft.position.distanceTo(initialPosition)).toBeGreaterThan(0);
  expect(frames.size).toBe(1);
  view.unmount();
  expect(frames.size).toBe(0);
  expect(motionListeners.size).toBe(0);
  expect(gpu.dispose).toHaveBeenCalledOnce();
});

it("keeps the lit station static for reduced motion and responds to preference changes", () => {
  reducedMotion = true;
  render(<ReviewGraphic />);
  expect(gpu.render).toHaveBeenCalled();
  expect(frames.size).toBe(0);
  expect(
    gpu.render.mock.calls[0][0].getObjectByName("habitat-lights"),
  ).toBeDefined();
  reducedMotion = false;
  for (const listener of motionListeners) listener();
  expect(frames.size).toBe(1);
  reducedMotion = true;
  for (const listener of motionListeners) listener();
  expect(frames.size).toBe(0);
});

it("pauses after context loss and resumes after restoration", () => {
  const { container } = render(<ReviewGraphic />);
  const canvas = container.querySelector("canvas");
  if (!canvas) throw new Error("The station must mount its renderer");
  fireEvent(canvas, new Event("webglcontextlost", { cancelable: true }));
  expect(frames.size).toBe(0);
  fireEvent(canvas, new Event("webglcontextrestored"));
  expect(frames.size).toBe(1);
});

it("does not block the page when WebGL is unavailable", () => {
  vi.stubGlobal("WebGLRenderingContext", undefined);
  const { container } = render(<ReviewGraphic />);
  expect(screen.getByRole("img")).toBeVisible();
  expect(container.querySelector("canvas")).toBeNull();
  expect(frames.size).toBe(0);
});
