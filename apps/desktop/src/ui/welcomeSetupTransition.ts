export const WELCOME_SETUP_DURATION_MS = 1700;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => value * value * (3 - 2 * value);

export function sampleWelcomeSetupTransition(elapsedMs: number) {
  return {
    frameProgress: clamp(elapsedMs / 320),
    zoomProgress: ease(clamp((elapsedMs - 520) / 1000)),
    opacity: 1 - ease(clamp((elapsedMs - 1450) / 250)),
    complete: elapsedMs >= WELCOME_SETUP_DURATION_MS,
  };
}
