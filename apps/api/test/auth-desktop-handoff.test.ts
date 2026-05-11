import { UnauthorizedException } from '@nestjs/common';
import { jwtVerify } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  desktopAuthHandoff: {
    create: vi.fn(),
    deleteMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  game: {
    findMany: vi.fn(),
  },
}));

vi.mock('../src/database', () => ({
  prisma: prismaMock,
}));

const { AuthService } = await import('../src/auth/auth.service');

function createService() {
  return new AuthService();
}

function createPendingHandoff(overrides: Record<string, unknown> = {}) {
  return {
    id: 'handoff-1',
    pollSecretHash:
      '0e3e16e9ef6f0c4887962402b8af7242b241128b711567a0baff5902dd3540b8',
    expiresAt: new Date(Date.now() + 60_000),
    approvedAt: null,
    consumedAt: null,
    approvedUserId: null,
    approvedUserEmail: null,
    approvedUserDisplayName: null,
    approvedUserAvatarUrl: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('AuthService desktop handoffs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_SECRET = 'desktop-handoff-secret';
    delete process.env.AUTH_SECRET;
    prismaMock.desktopAuthHandoff.deleteMany.mockResolvedValue({ count: 0 });
  });

  it('creates a short-lived handoff and stores only a hashed poll secret', async () => {
    prismaMock.desktopAuthHandoff.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: data.id,
        pollSecretHash: data.pollSecretHash,
        expiresAt: data.expiresAt,
      }),
    );

    const result = await createService().createDesktopAuthHandoff();

    expect(result.handoffId).toHaveLength(43);
    expect(result.pollSecret).toHaveLength(43);
    expect(result.pollIntervalMs).toBe(1_500);
    expect(result.expiresAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
    );
    expect(prismaMock.desktopAuthHandoff.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: result.handoffId,
        expiresAt: expect.any(Date),
      }),
    });
    expect(
      prismaMock.desktopAuthHandoff.create.mock.calls[0][0].data
        .pollSecretHash,
    ).not.toBe(result.pollSecret);
    expect(
      prismaMock.desktopAuthHandoff.deleteMany,
    ).toHaveBeenCalledWith({
      where: {
        OR: [
          { expiresAt: { lt: expect.any(Date) } },
          { consumedAt: { lt: expect.any(Date) } },
        ],
      },
    });
  });

  it('returns pending while a valid handoff waits for web approval', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    prismaMock.desktopAuthHandoff.findUnique.mockResolvedValue(
      createPendingHandoff({ expiresAt }),
    );

    const result = await createService().pollDesktopAuthHandoff({
      handoffId: 'handoff-1',
      pollSecret: 'poll-secret',
    });

    expect(result).toEqual({
      status: 'pending',
      expiresAt: expiresAt.toISOString(),
    });
    expect(prismaMock.desktopAuthHandoff.updateMany).not.toHaveBeenCalled();
  });

  it('approves an unexpired handoff and returns the desktop token only once', async () => {
    const approvedAt = new Date();
    const approvedHandoff = createPendingHandoff({
      approvedAt,
      approvedUserId: 'user-1',
      approvedUserEmail: 'solon@example.com',
      approvedUserDisplayName: 'Solon',
      approvedUserAvatarUrl: 'https://cdn.discordapp.com/avatar.png',
    });
    prismaMock.desktopAuthHandoff.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prismaMock.desktopAuthHandoff.findUnique.mockResolvedValue(approvedHandoff);

    const firstPoll = await createService().pollDesktopAuthHandoff({
      handoffId: 'handoff-1',
      pollSecret: 'poll-secret',
    });
    const secondPoll = await createService().pollDesktopAuthHandoff({
      handoffId: 'handoff-1',
      pollSecret: 'poll-secret',
    });

    expect(firstPoll.status).toBe('approved');
    if (firstPoll.status !== 'approved') {
      throw new Error('Expected approved result.');
    }
    const { payload } = await jwtVerify(
      firstPoll.token,
      new TextEncoder().encode('desktop-handoff-secret'),
      { algorithms: ['HS256'] },
    );
    expect(payload).toMatchObject({
      sub: 'user-1',
      email: 'solon@example.com',
      name: 'Solon',
      picture: 'https://cdn.discordapp.com/avatar.png',
      tokenUse: 'desktop-sync',
    });
    expect(secondPoll).toEqual({ status: 'expired' });
  });

  it('rejects approval when the handoff is missing or expired', async () => {
    prismaMock.desktopAuthHandoff.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      createService().approveDesktopAuthHandoff('handoff-1', {
        userId: 'user-1',
        email: 'solon@example.com',
        displayName: 'Solon',
        avatarUrl: null,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not leak state when the poll secret is invalid', async () => {
    prismaMock.desktopAuthHandoff.findUnique.mockResolvedValue(
      createPendingHandoff({ pollSecretHash: 'different-secret-hash' }),
    );

    const result = await createService().pollDesktopAuthHandoff({
      handoffId: 'handoff-1',
      pollSecret: 'poll-secret',
    });

    expect(result).toEqual({ status: 'expired' });
    expect(prismaMock.desktopAuthHandoff.updateMany).not.toHaveBeenCalled();
  });

  it('treats a missing poll secret as an expired handoff', async () => {
    prismaMock.desktopAuthHandoff.findUnique.mockResolvedValue(
      createPendingHandoff(),
    );

    const result = await createService().pollDesktopAuthHandoff({
      handoffId: 'handoff-1',
    });

    expect(result).toEqual({ status: 'expired' });
    expect(prismaMock.desktopAuthHandoff.updateMany).not.toHaveBeenCalled();
  });
});
