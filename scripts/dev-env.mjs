import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function parseEnvFile(contents) {
  const entries = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());

    entries[key] = value;
  }

  return entries;
}

export async function loadRootEnv(options = {}) {
  const envPath = options.envPath ?? resolve(process.cwd(), '../../.env');
  const contents = await readFile(envPath, 'utf8').catch(() => null);

  if (!contents) {
    return {};
  }

  const parsed = parseEnvFile(contents);

  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] ??= value;
  }

  return parsed;
}

export function resolveWebUrl(environment = process.env) {
  if (environment.SHADOW_CLOUD_WEB_URL) {
    return environment.SHADOW_CLOUD_WEB_URL;
  }

  if (environment.AUTH_URL) {
    return environment.AUTH_URL;
  }

  return `http://localhost:${environment.WEB_PORT ?? '3000'}`;
}

export function resolveWebPort(environment = process.env) {
  if (environment.WEB_PORT) {
    return environment.WEB_PORT;
  }

  if (environment.AUTH_URL) {
    const port = new URL(environment.AUTH_URL).port;

    if (port) {
      return port;
    }
  }

  return '3000';
}
