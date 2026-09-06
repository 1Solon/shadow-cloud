import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TurnMutationsService } from '../src/games/services/turn-mutations.service';

const prismaMock = vi.hoisted(() => ({
  game: { findFirst: vi.fn(), findUnique: vi.fn() },
  authIdentity: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../src/database', async () => ({
  ...(await import('@prisma/client')),
  prisma: prismaMock,
}));

const { GamesTurnService } =
  await import('../src/games/services/games-turn.service');

function createService() {
  const turnMutations = {
    replacePlayerInSeat: vi.fn<TurnMutationsService['replacePlayerInSeat']>(),
    resignPlayerFromDiscord:
      vi.fn<TurnMutationsService['resignPlayerFromDiscord']>(),
    skipPlayerTurn: vi.fn<TurnMutationsService['skipPlayerTurn']>(),
    transferHost: vi.fn<TurnMutationsService['transferHost']>(),
  };
  return {
    service: new GamesTurnService(turnMutations as never),
    turnMutations,
  };
}

describe('GamesTurnService administrative intention delegation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each(['result', 'error'])(
    'delegates replacement unchanged and propagates the %s',
    async (outcome) => {
      const { service, turnMutations } = createService();
      const input = Object.freeze({
        discordThreadId: 'thread-1',
        callerDiscordId: 'discord-2',
        seatNumber: 1,
        newPlayerDiscordId: 'discord-3',
        newPlayerDisplayName: 'Replacement',
      });
      const result = {
        gameId: 'game-1',
        slug: 'ashes',
        name: 'Ashes',
        player: {
          displayName: 'Replacement',
          turnOrder: 1,
          tookActiveTurn: true,
        },
      };
      const error = new ConflictException('The selected seat changed.');
      if (outcome === 'result') {
        turnMutations.replacePlayerInSeat.mockResolvedValue(result);
        await expect(service.replacePlayerInSeat(input)).resolves.toBe(result);
      } else {
        turnMutations.replacePlayerInSeat.mockRejectedValue(error);
        await expect(service.replacePlayerInSeat(input)).rejects.toBe(error);
      }
      expect(turnMutations.replacePlayerInSeat).toHaveBeenCalledExactlyOnceWith(
        input,
      );
      expect(turnMutations.replacePlayerInSeat.mock.calls[0][0]).toBe(input);
      expect(prismaMock.game.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['result', 'error'])(
    'delegates resignation unchanged and propagates the %s',
    async (outcome) => {
      const { service, turnMutations } = createService();
      const input = Object.freeze({
        discordThreadId: 'thread-1',
        playerDiscordId: 'discord-1',
      });
      const result = {
        gameId: 'game-1',
        slug: 'ashes',
        name: 'Ashes',
        player: { displayName: 'Alpha', turnOrder: 1, wasOrganizer: false },
      };
      const error = new ConflictException('The resigning player changed.');
      if (outcome === 'result') {
        turnMutations.resignPlayerFromDiscord.mockResolvedValue(result);
        await expect(service.resignPlayerFromDiscord(input)).resolves.toBe(
          result,
        );
      } else {
        turnMutations.resignPlayerFromDiscord.mockRejectedValue(error);
        await expect(service.resignPlayerFromDiscord(input)).rejects.toBe(
          error,
        );
      }
      expect(
        turnMutations.resignPlayerFromDiscord,
      ).toHaveBeenCalledExactlyOnceWith(input);
      expect(turnMutations.resignPlayerFromDiscord.mock.calls[0][0]).toBe(
        input,
      );
      expect(prismaMock.game.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['result', 'error'])(
    'delegates skip unchanged and propagates the %s',
    async (outcome) => {
      const { service, turnMutations } = createService();
      const input = Object.freeze({
        discordThreadId: 'thread-1',
        callerDiscordId: 'discord-2',
      });
      const result = {
        gameId: 'game-1',
        slug: 'ashes',
        name: 'Ashes',
        skippedPlayer: { displayName: 'Alpha', turnOrder: 1 },
        nextPlayer: {
          displayName: 'Overlord',
          discordId: 'discord-2',
          turnOrder: 2,
        },
      };
      const error = new ConflictException('The active turn changed.');
      if (outcome === 'result') {
        turnMutations.skipPlayerTurn.mockResolvedValue(result);
        await expect(service.skipPlayerTurn(input)).resolves.toBe(result);
      } else {
        turnMutations.skipPlayerTurn.mockRejectedValue(error);
        await expect(service.skipPlayerTurn(input)).rejects.toBe(error);
      }
      expect(turnMutations.skipPlayerTurn).toHaveBeenCalledExactlyOnceWith(
        input,
      );
      expect(turnMutations.skipPlayerTurn.mock.calls[0][0]).toBe(input);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['result', 'error'])(
    'delegates Overlord transfer unchanged and propagates the %s without caller-owned writes',
    async (outcome) => {
      const { service, turnMutations } = createService();
      const input = Object.freeze({ targetPlayerEntryId: 'seat-1' });
      const result = {
        gameId: 'game-1',
        gameNumber: 1,
        slug: 'ashes',
        name: 'Ashes',
        organizerId: 'user-1',
        organizerDisplayName: 'Alpha',
        player: { displayName: 'Alpha', turnOrder: 1 },
      };
      const error = new ConflictException('The target changed.');
      if (outcome === 'result') {
        turnMutations.transferHost.mockResolvedValue(result);
        await expect(service.transferHost('1', 'user-2', input)).resolves.toBe(
          result,
        );
      } else {
        turnMutations.transferHost.mockRejectedValue(error);
        await expect(service.transferHost('1', 'user-2', input)).rejects.toBe(
          error,
        );
      }
      expect(turnMutations.transferHost).toHaveBeenCalledExactlyOnceWith(
        '1',
        'user-2',
        input,
      );
      expect(prismaMock.game.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );
});
