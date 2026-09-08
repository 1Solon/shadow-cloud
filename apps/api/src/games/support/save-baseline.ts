import { ConflictException } from '@nestjs/common';

export function saveBaseline(game: {
  id: string;
  turnRevision: number;
  saveRevision: number;
}) {
  return `${game.id}:${game.turnRevision}:${game.saveRevision}`;
}

export function assertSaveBaseline(
  game: Parameters<typeof saveBaseline>[0],
  expected?: string,
) {
  if (expected !== undefined && expected !== saveBaseline(game)) {
    throw new ConflictException(
      'The campaign or save changed. Refresh and review the latest save before trying again.',
    );
  }
}
