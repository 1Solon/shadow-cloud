import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateDiscordGameDto } from '../src/games/dto/create-discord-game.dto';
import { UpdateGameMetadataDto } from '../src/games/dto/update-game-metadata.dto';

const durationFields = [
  'turnTargetHours',
  'turnReminderGraceHours',
  'turnReminderRepeatHours',
] as const;

const MAX_TURN_TIMING_HOURS = 1_000_000_000;

const invalidDurations = [
  0,
  -1,
  1.5,
  '1',
  Number.NaN,
  Infinity,
  MAX_TURN_TIMING_HOURS + 1,
  Number.MAX_SAFE_INTEGER + 1,
];

async function validateDuration(
  dto: CreateDiscordGameDto | UpdateGameMetadataDto,
  field: (typeof durationFields)[number],
  value: unknown,
) {
  Object.assign(dto, { [field]: value });
  const errors = await validate(dto);

  return errors.find((error) => error.property === field);
}

describe('turn policy DTO validation', () => {
  it.each([1, MAX_TURN_TIMING_HOURS])(
    'accepts in-range whole-hour durations in both DTOs: %s',
    async (value) => {
      for (const field of durationFields) {
        await expect(
          validateDuration(new CreateDiscordGameDto(), field, value),
        ).resolves.toBeUndefined();
        await expect(
          validateDuration(new UpdateGameMetadataDto(), field, value),
        ).resolves.toBeUndefined();
      }
    },
  );

  it.each(invalidDurations)(
    'rejects an invalid turn duration in both DTOs: %s',
    async (value) => {
      for (const field of durationFields) {
        await expect(
          validateDuration(new CreateDiscordGameDto(), field, value),
        ).resolves.toBeDefined();
        await expect(
          validateDuration(new UpdateGameMetadataDto(), field, value),
        ).resolves.toBeDefined();
      }
    },
  );

  it('accepts only boolean reminder enablement updates', async () => {
    await expect(
      validate(
        Object.assign(new UpdateGameMetadataDto(), {
          turnRemindersEnabled: true,
        }),
      ),
    ).resolves.toHaveLength(0);
    await expect(
      validate(
        Object.assign(new UpdateGameMetadataDto(), {
          turnRemindersEnabled: 'true',
        }),
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'turnRemindersEnabled' }),
      ]),
    );
  });
});
