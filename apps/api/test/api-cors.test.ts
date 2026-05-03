import { describe, expect, it } from 'vitest';
import { resolveCorsOrigins } from '../src/api-cors';

describe('resolveCorsOrigins', () => {
  it('allows local web and Tauri dev origins by default', () => {
    expect(resolveCorsOrigins({ WEB_PORT: '3200' })).toEqual([
      'http://localhost:3200',
      'http://127.0.0.1:1420',
      'http://localhost:1420',
      'http://tauri.localhost',
      'tauri://localhost',
    ]);
  });

  it('uses configured web and desktop origins without duplicates', () => {
    expect(
      resolveCorsOrigins({
        AUTH_URL: 'http://localhost:3200',
        SHADOW_CLOUD_DESKTOP_ORIGIN: 'http://127.0.0.1:1420',
        SHADOW_CLOUD_WEB_URL: 'http://localhost:3200',
      }),
    ).toEqual([
      'http://localhost:3200',
      'http://127.0.0.1:1420',
      'http://localhost:1420',
      'http://tauri.localhost',
      'tauri://localhost',
    ]);
  });
});
