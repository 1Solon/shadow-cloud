// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootSequence } from "@/components/boot-sequence";

vi.mock("ascii.rest/react", () => ({
  Ascii: ({ label }: { label: string }) => (
    <pre role="img" aria-label={label} />
  ),
}));
vi.mock("ascii.rest/pieces/boot-log", () => ({}));
vi.mock("@/components/terminal-title", () => ({
  TerminalTitle: () => <pre>SHADOW-CLOUD</pre>,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("BootSequence", () => {
  it("plays the boot log on the first visit and remembers it for the session", () => {
    render(
      <BootSequence>
        <p>Dashboard</p>
      </BootSequence>,
    );

    expect(
      screen.getByRole("img", { name: "Shadow Cloud booting" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Enter" });
    act(() => vi.advanceTimersByTime(3_000));

    expect(
      screen.queryByRole("img", { name: "Shadow Cloud booting" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(sessionStorage.getItem("shadow-cloud:booted")).not.toBeNull();
  });

  it("goes straight to the page once the session has booted", () => {
    sessionStorage.setItem("shadow-cloud:booted", "1");
    render(
      <BootSequence>
        <p>Dashboard</p>
      </BootSequence>,
    );

    expect(
      screen.queryByRole("img", { name: "Shadow Cloud booting" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("skips the boot splash entirely when motion is reduced", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    render(
      <BootSequence>
        <p>Dashboard</p>
      </BootSequence>,
    );

    expect(
      screen.queryByRole("img", { name: "Shadow Cloud booting" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Dashboard").parentElement).not.toHaveAttribute(
      "style",
    );
  });
});
