import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type { ReadStream } from 'node:fs';

function sanitizeSegment(value: string) {
  const trimmed = basename(value).trim();
  const sanitized = trimmed
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-');

  return sanitized || 'save-file';
}

function buildSaveFileName(input: {
  gameNumber: number;
  turn: number;
  seat: number;
  playerName: string;
  originalName: string;
}) {
  const sanitizedOriginalName = sanitizeSegment(input.originalName);
  const extension = extname(sanitizedOriginalName);
  const sanitizedPlayerName = sanitizeSegment(input.playerName);

  return `${input.gameNumber}-T${input.turn}-S${input.seat}-${sanitizedPlayerName}${extension}`;
}

@Injectable()
export class FileStorageService {
  private readonly rootDirectory = resolve(
    process.cwd(),
    process.env.SHADOW_CLOUD_SAVE_DIR ?? '.shadow-cloud',
    'saves',
  );

  async storeFile(input: {
    gameId: string;
    gameNumber: number;
    turn: number;
    seat: number;
    playerName: string;
    originalName: string;
    content: Buffer;
  }) {
    const gameDirectory = join(
      this.rootDirectory,
      sanitizeSegment(input.gameId),
    );
    const fileName = buildSaveFileName(input);
    const storagePath = join(gameDirectory, fileName);

    await mkdir(gameDirectory, { recursive: true });
    await writeFile(storagePath, input.content);

    return {
      storagePath,
      fileName,
    };
  }

  async stageUpload(input: {
    gameId: string;
    gameNumber: number;
    turn: number;
    seat: number;
    playerName: string;
    originalName: string;
    content: Buffer;
    prepare?: (storagePath: string) => Promise<void>;
  }) {
    const gameDirectory = join(
      this.rootDirectory,
      sanitizeSegment(input.gameId),
    );
    const fileName = buildSaveFileName(input);
    // Keep the canonical download name, but isolate bytes for each attempt so
    // rollback can remove its file without touching another committed upload.
    const storagePath = join(
      gameDirectory,
      `upload-${randomUUID()}-${fileName}`,
    );

    await input.prepare?.(storagePath);
    await mkdir(gameDirectory, { recursive: true });
    await this.writeStagedFile(storagePath, input.content);

    return { storagePath, fileName };
  }

  async stageReplacement(input: {
    gameId: string;
    canonicalName: string;
    content: Buffer;
    prepare?: (storagePath: string) => Promise<void>;
  }) {
    const gameDirectory = join(
      this.rootDirectory,
      sanitizeSegment(input.gameId),
    );
    const canonicalName = sanitizeSegment(input.canonicalName);
    const extension = extname(canonicalName);
    const baseName = canonicalName.slice(0, -extension.length) || 'save-file';
    const storagePath = join(
      gameDirectory,
      `${baseName}-replacement-${randomUUID()}${extension}`,
    );

    await input.prepare?.(storagePath);
    await mkdir(gameDirectory, { recursive: true });
    await this.writeStagedFile(storagePath, input.content);

    return { storagePath };
  }

  private async writeStagedFile(storagePath: string, content: Buffer) {
    try {
      await writeFile(storagePath, content, { flag: 'wx' });
    } catch (error) {
      // An exclusive-create collision belongs to someone else. Other write
      // failures can leave our partial file behind before the caller gets a path.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        await this.removeFile(storagePath);
      }
      throw error;
    }
  }

  async openDownload(storagePath: string): Promise<{
    size: number;
    lastModified: Date;
    stream: ReadStream;
  }> {
    const fileStats = await stat(storagePath);

    const stream = await new Promise<ReadStream>((resolveStream, reject) => {
      const nextStream = createReadStream(storagePath);

      const handleOpen = () => {
        nextStream.off('error', handleError);
        resolveStream(nextStream);
      };
      const handleError = (error: Error) => {
        nextStream.off('open', handleOpen);
        reject(error);
      };

      nextStream.once('open', handleOpen);
      nextStream.once('error', handleError);
    });

    return {
      size: fileStats.size,
      lastModified: fileStats.mtime,
      stream,
    };
  }

  async removeFile(storagePath: string) {
    await unlink(storagePath).catch(() => undefined);
  }

  async removeFileOrThrow(storagePath: string) {
    await unlink(storagePath);
  }
}
