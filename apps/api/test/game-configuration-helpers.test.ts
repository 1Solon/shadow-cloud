import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/database', () => ({
  ArmyCountPreset: {
    MILITIA_ONLY: 'MILITIA_ONLY',
    ONE_PER_ZONE: 'ONE_PER_ZONE',
    TWO_PER_ZONE: 'TWO_PER_ZONE',
  },
  GameDlcMode: {
    NONE: 'NONE',
    OCEANIA: 'OCEANIA',
    REPUBLICA: 'REPUBLICA',
    BOTH: 'BOTH',
  },
  GameMode: {
    TEAMS: 'TEAMS',
    TEAMS_AI: 'TEAMS_AI',
    FFA: 'FFA',
    FFA_AI: 'FFA_AI',
  },
  ZoneCountPreset: {
    CITY_STATE: 'CITY_STATE',
    TWO_ZONE_START: 'TWO_ZONE_START',
    THREE_ZONE_START: 'THREE_ZONE_START',
  },
}));

const { ArmyCountPreset, GameMode, ZoneCountPreset } = await import(
  '../src/database'
);
const { buildCanonicalThreadName } = await import(
  '../src/games/support/game-configuration.helpers'
);

describe('buildCanonicalThreadName', () => {
  it('uses the diamond emoji directly before the game number', () => {
    expect(
      buildCanonicalThreadName({
        gameNumber: 42,
        name: 'The Game',
      }),
    ).toBe('🔸42 : The Game');
  });

  it('preserves metadata suffixes after the title', () => {
    expect(
      buildCanonicalThreadName({
        gameNumber: 42,
        name: 'The Game',
        playerCount: 6,
        gameMode: GameMode.FFA,
        techLevel: 3,
        zoneCount: ZoneCountPreset.TWO_ZONE_START,
        armyCount: ArmyCountPreset.ONE_PER_ZONE,
      }),
    ).toBe('🔸42 : The Game (6S FFA T3 2Z 1A)');
  });

  it('truncates long titles to keep the thread name within Discord limits', () => {
    const threadName = buildCanonicalThreadName({
      gameNumber: 42,
      name: 'A'.repeat(120),
      playerCount: 6,
      gameMode: GameMode.FFA,
      techLevel: 3,
      zoneCount: ZoneCountPreset.TWO_ZONE_START,
      armyCount: ArmyCountPreset.ONE_PER_ZONE,
    });

    expect(threadName).toHaveLength(100);
    expect(threadName).toMatch(/^🔸42 : A+… \(6S FFA T3 2Z 1A\)$/);
  });
});
