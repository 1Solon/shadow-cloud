import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('password inspection deployment configuration', () => {
  it('passes the archive key to the API container without exposing it to web or bot', () => {
    const compose = readFileSync(
      resolve(__dirname, '../../../docker-compose.yml'),
      'utf8',
    );
    const api = compose.split('\n  api:\n')[1]?.split('\n  web:\n')[0];
    const otherServices = compose.split('\n  web:\n')[1];

    expect(api).toContain(
      'SHADOW_CLOUD_SAVE_ARCHIVE_KEY: ${SHADOW_CLOUD_SAVE_ARCHIVE_KEY:-}',
    );
    expect(otherServices).not.toContain('SHADOW_CLOUD_SAVE_ARCHIVE_KEY');
  });
});
