// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TurnModeGraphic } from "./TurnModeGraphic";

afterEach(cleanup);

it("marks every nearby star with its Shadow Pawn scan result", () => {
  render(<TurnModeGraphic />);

  expect(
    screen.getByRole("img", {
      name: "Four nearby stars scanned for Shadow Pawn presence",
    }),
  ).toBeVisible();
  expect(document.querySelectorAll(".turn-mode-detection")).toHaveLength(4);
  expect(
    document.querySelectorAll('.turn-mode-detection[data-present="true"]'),
  ).toHaveLength(2);
  expect(
    document.querySelectorAll('.turn-mode-detection[data-present="false"]'),
  ).toHaveLength(2);
  expect(document.querySelectorAll(".turn-mode-detection rect")).toHaveLength(
    4,
  );
  expect(screen.getAllByText("SHADOW PAWNS: PRESENT")).toHaveLength(2);
  expect(screen.getAllByText("SHADOW PAWNS: ABSENT")).toHaveLength(2);
});
