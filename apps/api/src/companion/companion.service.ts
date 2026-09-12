import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { FileVersion, Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { FileStorageService } from '../games/file-storage.service';
import { MAX_ARCHIVE_BYTES } from '../save-format';

const membership = (userId: string) => ({
  OR: [{ organizerId: userId }, { players: { some: { userId } } }],
});
const gameInclude = {
  turnState: { include: { activePlayer: true } },
  fileVersions: { orderBy: { versionNumber: 'desc' }, take: 1 },
} satisfies Prisma.GameInclude;

/** FileVersion is the durable Save publication: uploads append a monotonic
 * versionNumber; replacements change its contentRevision without adding a turn.
 * Website retention limits presentation only; this feed never truncates history.
 */
@Injectable()
export class CompanionService {
  constructor(
    private readonly database: PrismaClient,
    private readonly storage: FileStorageService,
  ) {}

  private async bytes(file: FileVersion) {
    try {
      const download = await this.storage.openDownload(file.storagePath);
      try {
        if (download.size > MAX_ARCHIVE_BYTES) throw new Error('size');
        let size = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of download.stream as AsyncIterable<Uint8Array>) {
          size += chunk.length;
          if (size > MAX_ARCHIVE_BYTES) throw new Error('size');
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks, size);
      } finally {
        download.stream.destroy();
      }
    } catch {
      throw new ServiceUnavailableException({ code: 'save-unavailable' });
    }
  }

  private async descriptor(file: FileVersion) {
    // Old applied migrations permit missing hash/size. Derive them from the
    // existing immutable artifact without rewriting historical migration data.
    const bytes =
      file.contentHash && file.clientFileSize != null
        ? null
        : await this.bytes(file);
    return {
      publication: file.versionNumber,
      fileVersionId: file.id,
      contentRevision: file.contentRevision,
      contentHash: file.contentHash ?? digest(bytes!),
      size: bytes?.length ?? file.clientFileSize!,
      filename: file.originalName,
      publishedAt: file.uploadedAt.toISOString(),
    };
  }

  async observe(userId: string) {
    return this.database.$transaction(async (tx) => {
      const games = await tx.game.findMany({
        where: membership(userId),
        orderBy: { id: 'asc' },
        include: gameInclude,
      });
      const campaigns = [];
      for (const game of games) {
        campaigns.push({
          id: game.id,
          number: game.gameNumber,
          name: game.name,
          round: game.turnState?.roundNumber ?? 1,
          activeLord:
            game.turnState?.activePlayer.displayName ?? 'No active player',
          turnStartedAt: game.turnState?.updatedAt.toISOString() ?? null,
          current: game.fileVersions[0]
            ? await this.descriptor(game.fileVersions[0])
            : null,
        });
      }
      return { campaigns };
    });
  }

  private async requireMembership(
    tx: Prisma.TransactionClient,
    userId: string,
    campaignId: string,
  ) {
    const game = await tx.game.findFirst({
      where: { id: campaignId, ...membership(userId) },
    });
    if (!game) throw new ForbiddenException({ code: 'campaign-access-lost' });
    return game;
  }

  async publications(userId: string, campaignId: string, after: number) {
    return this.database.$transaction(async (tx) => {
      await this.requireMembership(tx, userId, campaignId);
      const current = await tx.fileVersion.findFirst({
        where: { gameId: campaignId },
        orderBy: { versionNumber: 'desc' },
      });
      if (after > (current?.versionNumber ?? 0))
        throw new ConflictException({ code: 'invalid-cursor' });
      const files = await tx.fileVersion.findMany({
        where: { gameId: campaignId, versionNumber: { gt: after } },
        orderBy: { versionNumber: 'asc' },
        take: 100,
      });
      const publications = [];
      for (const file of files) publications.push(await this.descriptor(file));
      return {
        current: current ? await this.descriptor(current) : null,
        publications,
      };
    });
  }

  async download(
    userId: string,
    campaignId: string,
    fileId: string,
    revision: number,
    contentHash: string,
  ) {
    const read = () =>
      this.database.$transaction(async (tx) => {
        await this.requireMembership(tx, userId, campaignId);
        const file = await tx.fileVersion.findFirst({
          where: { id: fileId, gameId: campaignId },
        });
        if (!file) throw new NotFoundException({ code: 'save-not-found' });
        if (
          file.contentRevision !== revision ||
          (file.contentHash && file.contentHash !== contentHash)
        )
          throw new ConflictException({ code: 'save-changed' });
        return file;
      });
    const file = await read();
    const content = await this.bytes(file);
    const current = await read();
    if (
      current.storagePath !== file.storagePath ||
      digest(content) !== contentHash
    )
      throw new ConflictException({ code: 'save-changed' });
    return content;
  }
}
function digest(bytes: Buffer) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}
