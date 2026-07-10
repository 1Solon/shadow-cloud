import { describe, expect, it } from 'vitest';
import {
  addWholeHours,
  calculateFirstReminderAt,
  calculateNextReminderAt,
} from '../src/games/support/turn-timing';

const enabled = {
  turnTargetHours: 24,
  turnReminderGraceHours: 12,
  turnReminderRepeatHours: 24,
  turnRemindersEnabled: true,
};

describe('turn timing', () => {
  it('schedules the first reminder from target plus grace', () => {
    const start = new Date('2026-07-10T00:00:00.000Z');

    expect(calculateFirstReminderAt(start, enabled)?.toISOString()).toBe(
      '2026-07-11T12:00:00.000Z',
    );
  });

  it('schedules repeats from the latest processing time', () => {
    const last = new Date('2026-07-12T08:00:00.000Z');

    expect(calculateNextReminderAt(last, enabled)?.toISOString()).toBe(
      '2026-07-13T08:00:00.000Z',
    );
  });

  it('returns null while reminders are disabled', () => {
    expect(
      calculateFirstReminderAt(new Date(), {
        ...enabled,
        turnRemindersEnabled: false,
      }),
    ).toBeNull();
  });

  it('does not schedule a repeat while reminders are disabled', () => {
    expect(
      calculateNextReminderAt(new Date(), {
        ...enabled,
        turnRemindersEnabled: false,
      }),
    ).toBeNull();
  });

  it('rejects an invalid input date', () => {
    expect(() => addWholeHours(new Date('invalid'), 1)).toThrow(
      'Turn timing duration produces an invalid date.',
    );
  });

  it('rejects an unrepresentable result', () => {
    expect(() => addWholeHours(new Date(), Number.MAX_SAFE_INTEGER)).toThrow(
      'Turn timing duration produces an invalid date.',
    );
  });
});
