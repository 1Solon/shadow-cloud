import { describe, expect, it } from "vitest";
import {
  sampleWelcomeSetupTransition,
  WELCOME_SETUP_DURATION_MS,
} from "./welcomeSetupTransition";

describe("welcome setup transition", () => {
  it("draws the target box before the camera starts moving", () => {
    expect(sampleWelcomeSetupTransition(0)).toEqual({
      frameProgress: 0,
      zoomProgress: 0,
      opacity: 1,
      complete: false,
    });
    expect(sampleWelcomeSetupTransition(350)).toMatchObject({
      frameProgress: 1,
      zoomProgress: 0,
      opacity: 1,
    });
  });

  it("zooms smoothly before fading out to reveal setup", () => {
    const middle = sampleWelcomeSetupTransition(1000);
    expect(middle.zoomProgress).toBeGreaterThan(0);
    expect(middle.zoomProgress).toBeLessThan(1);
    expect(middle.opacity).toBe(1);
    const reveal = sampleWelcomeSetupTransition(1600);
    expect(reveal.zoomProgress).toBe(1);
    expect(reveal.opacity).toBeGreaterThan(0);
    expect(reveal.opacity).toBeLessThan(1);
    expect(reveal.complete).toBe(false);
  });

  it("finishes without overshooting even if a frame is delayed", () => {
    const finished = {
      frameProgress: 1,
      zoomProgress: 1,
      opacity: 0,
      complete: true,
    };
    expect(sampleWelcomeSetupTransition(WELCOME_SETUP_DURATION_MS)).toEqual(
      finished,
    );
    expect(
      sampleWelcomeSetupTransition(WELCOME_SETUP_DURATION_MS + 10000),
    ).toEqual(finished);
    expect(sampleWelcomeSetupTransition(-100)).toEqual(
      sampleWelcomeSetupTransition(0),
    );
  });
});
