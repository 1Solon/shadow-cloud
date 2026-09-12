import { describe, expect, it } from "vitest";
import { createNodeFieldData } from "./WelcomeNodeField";

describe("WelcomeNodeField geometry", () => {
  it("builds a deterministic field spread across the welcome background", () => {
    const field = createNodeFieldData();
    const repeat = createNodeFieldData();
    const horizontalPositions = field.positions.filter(
      (_, index) => index % 3 === 0,
    );

    expect(field).toEqual(repeat);
    expect(field.positions).toHaveLength(285 * 3);
    expect(field.sizes).toHaveLength(285);
    expect(field.opacities).toHaveLength(285);
    expect(field.phases).toHaveLength(285);
    expect(field.motion).toHaveLength(285);
    expect(Math.min(...horizontalPositions)).toBeLessThan(-0.9);
    expect(Math.max(...horizontalPositions)).toBeGreaterThan(0.9);
    expect(field.positions.every((value) => value >= -1 && value <= 1)).toBe(
      true,
    );
  });
});
