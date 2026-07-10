import { BadRequestException } from '@nestjs/common';
import { extname } from 'node:path';
import type { UploadedSaveFile } from './game-payload.types';

export function getMaxSaveFileSizeBytes() {
  return Number(
    process.env.SHADOW_CLOUD_MAX_SAVE_SIZE_BYTES ?? 25 * 1024 * 1024,
  );
}

export function assertReplacementSaveFile(file: UploadedSaveFile) {
  if (!file.originalname || file.buffer.byteLength === 0) {
    throw new BadRequestException('A replacement save file is required.');
  }

  if (extname(file.originalname).toLowerCase() !== '.se1') {
    throw new BadRequestException(
      'Replacement files must use the .se1 extension.',
    );
  }

  if (file.buffer.byteLength > getMaxSaveFileSizeBytes()) {
    throw new BadRequestException('The replacement save exceeds 25 MB.');
  }
}
