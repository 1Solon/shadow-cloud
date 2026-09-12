// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConnectGraphic } from "./ConnectGraphic";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("stays powered on Connect until the user leaves that step", () => {
  vi.useFakeTimers();
  const view = render(<ConnectGraphic stage="sign-in" connected={false} />);
  const graphic = () => document.querySelector(".connect-graphic");
  expect(graphic()).toHaveAttribute("data-powered", "false");
  expect(graphic()).toHaveAttribute("aria-hidden", "true");
  view.rerender(<ConnectGraphic stage="sign-in" connected />);
  expect(graphic()).toHaveAttribute("data-powered", "true");
  act(() => {
    vi.advanceTimersByTime(2100);
  });
  expect(graphic()).toHaveAttribute("data-powered", "true");
  view.rerender(<ConnectGraphic stage="companion-root" connected />);
  expect(graphic()).toBeNull();
  view.rerender(<ConnectGraphic stage="sign-in" connected />);
  expect(graphic()).toHaveAttribute("data-powered", "true");
  view.rerender(<ConnectGraphic stage="welcome" connected />);
  expect(graphic()).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("renders a flat systems diagram without needing WebGL or adding interactive controls", () => {
  const view = render(<ConnectGraphic stage="sign-in" connected={false} />);
  const graphic = view.container.querySelector(".connect-graphic");
  expect(graphic?.querySelector("svg")).toHaveAttribute(
    "viewBox",
    "80 220 720 285",
  );
  expect(graphic?.querySelector("svg")).toHaveAttribute(
    "preserveAspectRatio",
    "xMidYMin meet",
  );
  expect(graphic?.querySelector("canvas")).toBeNull();
  const labels = () =>
    [
      ...view.container.querySelectorAll(
        ".connect-system-label, .connect-system-title",
      ),
    ].map((text) => text.textContent?.trim());
  expect(labels()).toEqual(["LIQUID ENERGY", "QTT", "Shadow"]);
  expect(graphic).not.toHaveTextContent(/%|DEVICE SESSION|RESERVE|AUTH GATE/);
  expect(graphic?.querySelector("[data-reserve]")).toHaveAttribute(
    "data-reserve",
    "0.08",
  );
  expect(view.queryByRole("button")).toBeNull();
  expect(view.queryByRole("img")).toBeNull();

  view.rerender(<ConnectGraphic stage="sign-in" connected />);
  expect(graphic).toHaveAttribute("data-powered", "true");
  expect(labels()).toEqual(["LIQUID ENERGY", "QTT", "Shadow"]);
  view.rerender(<ConnectGraphic stage="sign-in" connected={false} />);
  expect(graphic).toHaveAttribute("data-powered", "false");
  expect(labels()).toEqual(["LIQUID ENERGY", "QTT", "Shadow"]);
});

it("keeps the damaged lower-right QTT segment and both exact warning callouts after connection", () => {
  const view = render(<ConnectGraphic stage="sign-in" connected={false} />);
  const damage = view.container.querySelector(".connect-system-damage");
  expect(damage).not.toBeNull();
  expect(damage?.querySelectorAll("path").length).toBeGreaterThan(2);
  const fractured = damage?.innerHTML;
  for (const [name, warning] of [
    ["energy", "Warning: Low LE, Refuel Needed!"],
    ["maintenance", "Warning: Maintenance window exceeded by NaN!"],
  ]) {
    const callout = view.container.querySelector(
      `.connect-system-warning--${name}`,
    );
    expect(callout).toHaveTextContent(warning);
    expect(callout?.querySelector("path")).not.toBeNull();
    expect(callout?.querySelector("circle")).not.toBeNull();
  }
  view.rerender(<ConnectGraphic stage="sign-in" connected />);
  expect(
    view.container.querySelector(".connect-system-damage")?.innerHTML,
  ).toBe(fractured);
  expect(
    view.container.querySelectorAll(".connect-system-warning"),
  ).toHaveLength(2);
});

it("never overlays the next setup step, even if connection and navigation arrive together", () => {
  const view = render(<ConnectGraphic stage="sign-in" connected={false} />);
  expect(document.querySelector(".connect-graphic")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  view.rerender(<ConnectGraphic stage="companion-root" connected />);
  expect(document.querySelector(".connect-graphic")).toBeNull();
});

it("replaces the terminal endpoint with a bounded, varied nano swarm that stays stable across connection changes", () => {
  const view = render(<ConnectGraphic stage="sign-in" connected={false} />);
  const cloud = view.container.querySelector(".connect-system-cloud");
  const particles = [
    ...(cloud?.querySelectorAll(".connect-system-nano-particle") ?? []),
  ];
  expect(particles.length).toBeGreaterThan(30);
  expect(cloud?.querySelector(".connect-system-outline")).toBeNull();
  expect(cloud?.querySelector("text")).toHaveTextContent("Shadow");
  const positions = () =>
    particles.map((particle) => [
      particle.getAttribute("x"),
      particle.getAttribute("y"),
    ]);
  const before = positions();
  for (const [x, y] of before) {
    expect(Number(x)).toBeGreaterThan(735);
    expect(Number(x)).toBeLessThan(855);
    expect(Number(y)).toBeGreaterThan(295);
    expect(Number(y)).toBeLessThan(385);
  }
  expect(
    new Set(particles.map((particle) => particle.getAttribute("width"))).size,
  ).toBeGreaterThan(2);
  view.rerender(<ConnectGraphic stage="sign-in" connected />);
  expect(view.container.querySelector(".connect-graphic")).toHaveAttribute(
    "data-powered",
    "true",
  );
  expect(positions()).toEqual(before);
  expect(cloud).not.toHaveTextContent(/NANO|%|SESSION/);
});

it("pauses the schematic when the window is hidden and cleans up after navigation", () => {
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const removed = vi.spyOn(document, "removeEventListener");
  const view = render(<ConnectGraphic stage="sign-in" connected={false} />);
  const graphic = view.container.querySelector(".connect-graphic");
  hidden.mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  expect(graphic).toHaveAttribute("data-suspended", "true");
  hidden.mockReturnValue(false);
  fireEvent(document, new Event("visibilitychange"));
  expect(graphic).toHaveAttribute("data-suspended", "false");
  view.rerender(<ConnectGraphic stage="welcome" connected={false} />);
  expect(removed).toHaveBeenCalledWith(
    "visibilitychange",
    expect.any(Function),
  );
});

it("gives each diagram its own liquid clip and shading references", () => {
  const view = render(
    <>
      <ConnectGraphic stage="sign-in" connected={false} />
      <ConnectGraphic stage="sign-in" connected />
    </>,
  );
  const ids = [...view.container.querySelectorAll("[id]")].map(
    (element) => element.id,
  );
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
});
