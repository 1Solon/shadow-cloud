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
import { RootGraphic } from "./RootGraphic";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("advances, stops to scan, reports rejection, then advances the next pod", () => {
  vi.useFakeTimers();
  const view = render(<RootGraphic displayName="SOLON" selected={false} />);
  const graphic = view.container.querySelector(".root-graphic");
  const terminal = view.container.querySelector(".cryo-terminal");

  expect(graphic).toHaveAttribute("data-phase", "cycling");
  expect(graphic).toHaveAttribute("data-cycle-phase", "advancing");
  expect(graphic?.querySelectorAll(".cryo-pod")).toHaveLength(5);
  expect(graphic?.querySelector(".cryo-pod-vitals")).not.toBeInTheDocument();
  expect(graphic?.querySelectorAll(".cryo-pod-occupant")).toHaveLength(5);
  expect(graphic?.querySelectorAll(".cryo-pod--broken")).toHaveLength(4);
  expect(
    new Set(
      [...(graphic?.querySelectorAll(".cryo-pod") ?? [])].map((pod) =>
        pod.getAttribute("data-damage"),
      ),
    ).size,
  ).toBeGreaterThan(3);
  const scannerShell = graphic?.querySelector(".cryo-scanner-shell");
  expect(scannerShell?.tagName.toLowerCase()).toBe("path");
  expect(scannerShell).toHaveAttribute("data-damage", "25");
  expect(scannerShell).toHaveAttribute(
    "d",
    "M310 -4 H350 V14 H310 L306 10 L311 6 L305 2 Z",
  );
  expect(graphic?.querySelector(".cryo-scanner-emitters")).toHaveAttribute(
    "d",
    "M313 8 H318 L317 14 H314 Z M321 8 H326 L325 14 H322 Z M329 8 H334 L333 14 H330 Z",
  );
  expect(graphic?.querySelector(".cryo-scanner-aperture")).toBeNull();
  expect(graphic?.querySelector(".cryo-scanner-core")).toBeNull();
  expect(
    graphic?.querySelector(".cryo-scanner .cryo-scan-cone"),
  ).toHaveAttribute("d", "M313 14 L270 226 H376 L333 14 Z");
  expect(graphic?.querySelector(".cryo-scanner-cracks")).toBeNull();
  expect(graphic?.querySelector(".cryo-scanner-fragments")).toBeNull();
  expect(graphic?.querySelector(".cryo-scanner-debris")).toBeNull();
  const scannerCallout = graphic?.querySelector(".cryo-scanner-callout");
  expect(scannerCallout).toHaveTextContent("SCANNER (ORGANIC)");
  expect(scannerCallout?.querySelector("circle")).not.toBeNull();
  expect(scannerCallout?.querySelector("path")).toHaveAttribute(
    "d",
    "M350 4 H456",
  );
  expect(scannerCallout?.querySelector("text")).toHaveAttribute("y", "4");
  expect(scannerCallout?.querySelector("text")).toHaveAttribute(
    "dominant-baseline",
    "hanging",
  );
  expect(graphic?.querySelectorAll(".cryo-pod")[2]).toHaveAttribute(
    "transform",
    "translate(258 0)",
  );
  expect(graphic?.querySelector(".cryo-scan-beam")).not.toBeInTheDocument();
  expect(graphic?.querySelectorAll(".cryo-pod text")[2]).toHaveTextContent(
    "CR-042",
  );
  expect(graphic?.querySelector(".cryo-terminal-title")).toBeNull();
  expect(screen.queryByText("CRYO VIABILITY SCAN")).not.toBeInTheDocument();
  expect(terminal).toHaveTextContent("CONVEYOR: ADVANCING");
  expect(terminal).not.toHaveTextContent("SHADOW PRESENCE NOT DETECTED");

  act(() => vi.advanceTimersByTime(800));
  expect(graphic).toHaveAttribute("data-cycle-phase", "scanning");
  expect(terminal).toHaveTextContent("SCANNER (ORGANIC): IN PROGRESS");
  expect(terminal).not.toHaveTextContent("SHADOW PRESENCE NOT DETECTED");

  act(() => vi.advanceTimersByTime(850));
  expect(graphic).toHaveAttribute("data-cycle-phase", "reporting");
  expect(terminal).toHaveTextContent("SHADOW PRESENCE NOT DETECTED");
  expect(terminal).toHaveTextContent("[REJECTED] ADVANCE NEXT POD");

  act(() => vi.advanceTimersByTime(1500));
  expect(graphic).toHaveAttribute("data-cycle-phase", "advancing");
  expect(graphic?.querySelectorAll(".cryo-pod text")[2]).toHaveTextContent(
    "CR-119",
  );
  expect(terminal).not.toHaveTextContent("IDENTITY CHECK FAILED");
});

it("keeps each pod's damage state attached to its ID as it crosses the track", () => {
  vi.useFakeTimers();
  const view = render(<RootGraphic displayName="SOLON" selected={false} />);

  const visibleStates = () =>
    [...view.container.querySelectorAll(".cryo-pod")].map((pod) => ({
      id: pod.querySelector("text")?.textContent,
      damage: pod.getAttribute("data-damage"),
    }));
  const initialDamage = new Map<string | null | undefined, string | null>();
  for (const pod of visibleStates()) {
    if (initialDamage.has(pod.id)) {
      expect(pod.damage).toBe(initialDamage.get(pod.id));
    } else {
      initialDamage.set(pod.id, pod.damage);
    }
  }

  act(() => vi.advanceTimersByTime(3150));
  for (const pod of visibleStates()) {
    expect(pod.damage).toBe(initialDamage.get(pod.id));
  }
});

it("selects the connected Shadow Lord and finishes the release animation", () => {
  vi.useFakeTimers();
  const view = render(<RootGraphic displayName="SOLON" selected={false} />);

  view.rerender(<RootGraphic displayName="SOLON" selected />);
  const graphic = view.container.querySelector(".root-graphic");
  expect(graphic).toHaveAttribute("data-phase", "releasing");
  expect(screen.getByText("IDENTITY: SOLON")).toBeVisible();
  expect(screen.getByText("SHADOW LORD PRESENCE: CONFIRMED")).toBeVisible();
  expect(screen.getAllByText("CR-042")).toHaveLength(1);
  expect(screen.getByText("> SCAN CR-042")).toBeVisible();
  expect(screen.queryByText(/CR-ROOT/)).not.toBeInTheDocument();
  expect(graphic?.querySelector(".cryo-occupant-release")).not.toBeNull();
  expect(graphic?.querySelector(".cryo-occupant-callout")).toBeNull();
  expect(graphic?.querySelector(".cryo-selected-name")).toBeNull();

  act(() => vi.advanceTimersByTime(1900));
  expect(graphic).toHaveAttribute("data-phase", "complete");
});

it("does not replay the release when returning to an already selected root", () => {
  const view = render(<RootGraphic displayName="SOLON" selected />);
  expect(view.container.querySelector(".root-graphic")).toHaveAttribute(
    "data-phase",
    "complete",
  );
});

it("pauses cycling while the window is hidden", () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const view = render(<RootGraphic displayName="SOLON" selected={false} />);
  const graphic = view.container.querySelector(".root-graphic");

  hidden.mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  expect(graphic).toHaveAttribute("data-suspended", "true");
});
