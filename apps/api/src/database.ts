import { PrismaClient } from '@prisma/client';

declare global {
  var __shadowCloudPrisma__: PrismaClient | undefined;
}

export const prisma = globalThis.__shadowCloudPrisma__ ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__shadowCloudPrisma__ = prisma;
}

export * from '@prisma/client';
