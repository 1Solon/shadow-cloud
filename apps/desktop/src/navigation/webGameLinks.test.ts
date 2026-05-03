import { describe, expect, it } from 'vitest';
import { buildWebGameUrl } from './webGameLinks';

describe('web game links', () => {
  it('builds a web UI game URL from the configured base URL', () => {
    expect(buildWebGameUrl('http://localhost:3200/', 42)).toBe(
      'http://localhost:3200/games/42',
    );
  });
});
