import { isAbsolute, resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

function resolveDatasourceUrl(databaseUrl) {
  if (!databaseUrl || databaseUrl === ':memory:') {
    return databaseUrl ?? '';
  }

  const normalizedPath = databaseUrl.startsWith('file:')
    ? databaseUrl.slice('file:'.length)
    : databaseUrl;

  if (normalizedPath === ':memory:' || isAbsolute(normalizedPath)) {
    return databaseUrl;
  }

  return `file:${resolve('prisma', normalizedPath).replace(/\\/g, '/')}`;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: resolveDatasourceUrl(process.env.DATABASE_URL),
  },
});