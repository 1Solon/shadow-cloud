export type TurnReminderPolicy = {
  turnTargetHours: number;
  turnReminderGraceHours: number;
  turnReminderRepeatHours: number;
  turnRemindersEnabled: boolean;
};

export const MAX_TURN_TIMING_HOURS = 1_000_000_000;

const HOUR_MS = 60 * 60 * 1000;

export function addWholeHours(at: Date, hours: number): Date {
  const result = new Date(at.getTime() + hours * HOUR_MS);

  if (Number.isNaN(result.getTime())) {
    throw new RangeError('Turn timing duration produces an invalid date.');
  }

  return result;
}

export function calculateFirstReminderAt(
  startedAt: Date,
  policy: TurnReminderPolicy,
): Date | null {
  return policy.turnRemindersEnabled
    ? addWholeHours(
        startedAt,
        policy.turnTargetHours + policy.turnReminderGraceHours,
      )
    : null;
}

export function calculateNextReminderAt(
  lastReminderAt: Date,
  policy: TurnReminderPolicy,
): Date | null {
  return policy.turnRemindersEnabled
    ? addWholeHours(lastReminderAt, policy.turnReminderRepeatHours)
    : null;
}
