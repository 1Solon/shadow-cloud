export type SyncTickResult =
  | {
      status: 'completed';
    }
  | {
      status: 'skipped';
      reason: 'sync-already-running';
    };

export function createNonOverlappingRunner(
  sync: () => Promise<void>,
): { tick: () => Promise<SyncTickResult>; isRunning: () => boolean } {
  let running = false;

  return {
    isRunning() {
      return running;
    },
    async tick() {
      if (running) {
        return {
          status: 'skipped',
          reason: 'sync-already-running',
        };
      }

      running = true;

      try {
        await sync();
        return {
          status: 'completed',
        };
      } finally {
        running = false;
      }
    },
  };
}
