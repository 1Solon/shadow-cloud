import { describe, expect, it } from 'vitest';
import { createNonOverlappingRunner } from './sync-runner';

describe('createNonOverlappingRunner', () => {
  it('skips ticks while a sync is already running', async () => {
    let releaseSync!: () => void;
    let calls = 0;
    const runner = createNonOverlappingRunner(async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        releaseSync = resolve;
      });
    });

    const first = runner.tick();
    const second = runner.tick();

    await expect(second).resolves.toEqual({
      status: 'skipped',
      reason: 'sync-already-running',
    });

    releaseSync();
    await first;
    const third = runner.tick();
    releaseSync();
    await third;

    expect(calls).toBe(2);
  });
});
