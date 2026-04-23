import type { Prisma } from '../../database';

export function buildGameIdentifierWhere(
  gameIdentifier: string,
): Prisma.GameWhereInput {
  const parsedGameNumber = Number.parseInt(gameIdentifier, 10);
  const matchesGameNumber =
    Number.isSafeInteger(parsedGameNumber) &&
    String(parsedGameNumber) === gameIdentifier;

  return {
    OR: [
      { id: gameIdentifier },
      { slug: gameIdentifier },
      ...(matchesGameNumber ? [{ gameNumber: parsedGameNumber }] : []),
    ],
  };
}
