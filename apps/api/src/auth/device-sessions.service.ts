import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { PrismaClient } from '../database';

const handoffTtlMs = 10 * 60 * 1_000;
const handoffPruneAgeMs = 24 * 60 * 60 * 1_000;
const accessTokenTtlMs = 15 * 60 * 1_000;
const deviceSessionTtlMs = 180 * 24 * 60 * 60 * 1_000;

export const companionScopes = [
  'campaigns:observe',
  'saves:download',
  'turns:submit',
] as const;

type ExchangeInput =
  | { handoffId: string; pollSecret: string; handoffToken?: never }
  | { handoffToken: string; handoffId?: never; pollSecret?: never };

export type CompanionAccessPayload = JWTPayload & {
  tokenUse: 'companion-access';
  deviceSessionId: string;
  scope: string[];
};

@Injectable()
export class DeviceSessionsService {
  private readonly encoder = new TextEncoder();

  constructor(private readonly database: PrismaClient) {}

  async createHandoff() {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + handoffTtlMs);
    const pruneBefore = new Date(now.getTime() - handoffPruneAgeMs);
    const handoffId = randomToken();
    const pollSecret = randomToken();

    await this.database.companionHandoff.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: pruneBefore } },
          { consumedAt: { lt: pruneBefore } },
        ],
      },
    });
    await this.database.companionHandoff.create({
      data: {
        id: handoffId,
        pollSecretHash: hashSecret(pollSecret),
        expiresAt,
      },
    });

    return {
      handoffId,
      pollSecret,
      expiresAt: expiresAt.toISOString(),
      pollIntervalMs: 1_500,
      approvalPath: `/api/auth/companion?handoff=${encodeURIComponent(handoffId)}`,
    };
  }

  async approveHandoff(handoffId: string, userId: string) {
    if (!isTokenPart(handoffId) || !userId || userId.length > 128) {
      throw unavailable();
    }
    const pasteSecret = randomToken();
    const approved = await this.database.companionHandoff.updateMany({
      where: {
        id: handoffId,
        expiresAt: { gt: new Date() },
        approvedAt: null,
        consumedAt: null,
      },
      data: {
        approvedAt: new Date(),
        approvedUserId: userId,
        pasteSecretHash: hashSecret(pasteSecret),
      },
    });

    if (approved.count !== 1) {
      throw unavailable();
    }

    return {
      status: 'approved' as const,
      pasteToken: `${handoffId}.${pasteSecret}`,
    };
  }

  async exchangeHandoff(input: ExchangeInput) {
    const proof = parseExchangeProof(input);
    const handoff = await this.database.companionHandoff.findUnique({
      where: { id: proof.handoffId },
    });

    if (
      !handoff ||
      handoff.expiresAt <= new Date() ||
      handoff.consumedAt ||
      !matchesSecret(
        proof.secret,
        proof.kind === 'poll'
          ? handoff.pollSecretHash
          : handoff.pasteSecretHash,
      )
    ) {
      throw unavailable();
    }

    if (!handoff.approvedAt || !handoff.approvedUserId) {
      if (proof.kind === 'poll') {
        return {
          status: 'pending' as const,
          expiresAt: handoff.expiresAt.toISOString(),
        };
      }
      throw unavailable();
    }

    const sessionId = randomToken();
    const refreshSecret = randomToken();
    const refreshToken = `${sessionId}.${refreshSecret}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + deviceSessionTtlMs);

    const session = await this.database.$transaction(async (transaction) => {
      const consumed = await transaction.companionHandoff.updateMany({
        where: {
          id: handoff.id,
          consumedAt: null,
          expiresAt: { gt: now },
          approvedAt: { not: null },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw unavailable();
      }
      return transaction.deviceSession.create({
        data: {
          id: sessionId,
          userId: handoff.approvedUserId!,
          refreshSecretHash: hashSecret(refreshSecret),
          expiresAt,
          lastUsedAt: now,
        },
        include: { user: true },
      });
    });

    return this.issueCredentials(session, refreshToken);
  }

  async refresh(refreshToken: string) {
    const proof = parseRefreshToken(refreshToken);
    const session = await this.database.deviceSession.findUnique({
      where: { id: proof.sessionId },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !matchesSecret(proof.secret, session.refreshSecretHash)
    ) {
      throw unavailable();
    }

    const nextSecret = randomToken();
    const now = new Date();
    const rotated = await this.database.deviceSession.updateMany({
      where: {
        id: session.id,
        refreshSecretHash: session.refreshSecretHash,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        refreshSecretHash: hashSecret(nextSecret),
        lastUsedAt: now,
      },
    });
    if (rotated.count !== 1) {
      throw unavailable();
    }

    return this.issueCredentials(session, `${session.id}.${nextSecret}`);
  }

  async revoke(refreshToken: string) {
    const proof = parseRefreshToken(refreshToken);
    const session = await this.database.deviceSession.findUnique({
      where: { id: proof.sessionId },
    });
    if (!session || !matchesSecret(proof.secret, session.refreshSecretHash)) {
      throw unavailable();
    }
    await this.database.deviceSession.updateMany({
      where: {
        id: session.id,
        refreshSecretHash: session.refreshSecretHash,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    return { status: 'revoked' as const };
  }

  async verifyAccessToken(token: string) {
    const secret = configuredSecret();
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.encoder.encode(secret), {
        algorithms: ['HS256'],
        audience: 'shadow-cloud-companion',
        issuer: 'shadow-cloud-api',
      }));
    } catch {
      throw unavailable();
    }
    const scopes = payload.scope;
    if (
      payload.tokenUse !== 'companion-access' ||
      typeof payload.deviceSessionId !== 'string' ||
      typeof payload.sub !== 'string' ||
      !Array.isArray(scopes) ||
      !companionScopes.every((scope) =>
        scopes.some((value: unknown) => value === scope),
      )
    ) {
      throw unavailable();
    }
    const session = await this.database.deviceSession.findUnique({
      where: { id: payload.deviceSessionId },
    });
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      throw unavailable();
    }
    return payload as CompanionAccessPayload;
  }

  private async issueCredentials(
    session: {
      id: string;
      expiresAt: Date;
      user: { id: string; email: string; displayName: string };
    },
    refreshToken: string,
  ) {
    const accessTokenExpiresAt = new Date(Date.now() + accessTokenTtlMs);
    const accessToken = await new SignJWT({
      tokenUse: 'companion-access',
      deviceSessionId: session.id,
      scope: [...companionScopes],
      email: session.user.email,
      name: session.user.displayName,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(accessTokenExpiresAt.getTime() / 1_000))
      .setIssuer('shadow-cloud-api')
      .setAudience('shadow-cloud-companion')
      .setSubject(session.user.id)
      .sign(this.encoder.encode(configuredSecret()));

    return {
      status: 'approved' as const,
      accessToken,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      refreshToken,
      deviceSession: {
        id: session.id,
        expiresAt: session.expiresAt.toISOString(),
        scopes: [...companionScopes],
        user: {
          id: session.user.id,
          email: session.user.email,
          displayName: session.user.displayName,
        },
      },
    };
  }
}

function configuredSecret() {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new UnauthorizedException('NEXTAUTH_SECRET is not configured.');
  }
  return secret;
}

function randomToken() {
  return randomBytes(32).toString('base64url');
}

function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

function matchesSecret(secret: string, expectedHash: string | null) {
  if (!expectedHash) return false;
  const actual = Buffer.from(hashSecret(secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseExchangeProof(input: ExchangeInput) {
  if (
    typeof input.handoffId === 'string' &&
    typeof input.pollSecret === 'string' &&
    isTokenPart(input.handoffId) &&
    isTokenPart(input.pollSecret)
  ) {
    return {
      kind: 'poll' as const,
      handoffId: input.handoffId,
      secret: input.pollSecret,
    };
  }
  if (typeof input.handoffToken === 'string') {
    const [handoffId, secret, extra] = input.handoffToken.split('.');
    if (isTokenPart(handoffId) && isTokenPart(secret) && !extra) {
      return { kind: 'paste' as const, handoffId, secret };
    }
  }
  throw unavailable();
}

function parseRefreshToken(refreshToken: string) {
  if (typeof refreshToken === 'string') {
    const [sessionId, secret, extra] = refreshToken.split('.');
    if (isTokenPart(sessionId) && isTokenPart(secret) && !extra) {
      return { sessionId, secret };
    }
  }
  throw unavailable();
}

function isTokenPart(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function unavailable() {
  return new UnauthorizedException('Device session credential is unavailable.');
}
