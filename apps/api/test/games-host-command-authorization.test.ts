import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  game: {
    findUnique: vi.fn(),
  },
  authIdentity: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../src/database', () => ({
  AuditEventType: {
    FILE_UPLOADED: 'FILE_UPLOADED',
    GAME_CREATED: 'GAME_CREATED',
    METADATA_UPDATED: 'METADATA_UPDATED',
    PLAYER_REPLACED: 'PLAYER_REPLACED',
    PLAYER_RESIGNED: 'PLAYER_RESIGNED',
    REGISTRATION_APPROVED: 'REGISTRATION_APPROVED',
    REGISTRATION_REJECTED: 'REGISTRATION_REJECTED',
    REGISTRATION_REQUESTED: 'REGISTRATION_REQUESTED',
    ROSTER_UPDATED: 'ROSTER_UPDATED',
    TURN_ADVANCED: 'TURN_ADVANCED',
    TURN_REASSIGNED: 'TURN_REASSIGNED',
    TURN_SKIPPED: 'TURN_SKIPPED',
  },
  GameRole: {
    ORGANIZER: 'ORGANIZER',
    PLAYER: 'PLAYER',
  },
  prisma: prismaMock,
}));

const { GamesService } = await import('../src/games/games.service');

function createService() {
  return new GamesService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

function createGame() {
  return {
    id: 'game-1',
    slug: 'ashes',
    name: 'Ashes',
    organizerId: 'user-1',
  };
}

describe('GamesService host command authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.game.findUnique.mockResolvedValue(createGame());
    prismaMock.authIdentity.findUnique.mockResolvedValue({
      userId: 'user-1',
    });
  });

  it('authorizes the organizer for pinning commands', async () => {
    const result = await createService().authorizeHostCommand({
      discordThreadId: 'thread-1',
      callerDiscordId: 'discord-1',
      commandName: 'pin',
    });

    expect(result).toEqual({
      gameId: 'game-1',
      slug: 'ashes',
      name: 'Ashes',
    });
    expect(prismaMock.game.findUnique).toHaveBeenCalledWith({
      where: { discordThreadId: 'thread-1' },
      select: {
        id: true,
        slug: true,
        name: true,
        organizerId: true,
      },
    });
    expect(prismaMock.authIdentity.findUnique).toHaveBeenCalledWith({
      where: {
        provider_providerId: {
          provider: 'discord',
          providerId: 'discord-1',
        },
      },
    });
  });

  it('authorizes the organizer for unpinning commands', async () => {
    await expect(
      createService().authorizeHostCommand({
        discordThreadId: 'thread-1',
        callerDiscordId: 'discord-1',
        commandName: 'unpin',
      }),
    ).resolves.toMatchObject({
      gameId: 'game-1',
    });
  });

  it('rejects a Discord user who is not the organizer', async () => {
    prismaMock.authIdentity.findUnique.mockResolvedValue({
      userId: 'user-2',
    });

    await expect(
      createService().authorizeHostCommand({
        discordThreadId: 'thread-1',
        callerDiscordId: 'discord-2',
        commandName: 'pin',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unknown Discord thread', async () => {
    prismaMock.game.findUnique.mockResolvedValue(null);

    await expect(
      createService().authorizeHostCommand({
        discordThreadId: 'missing-thread',
        callerDiscordId: 'discord-1',
        commandName: 'pin',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
