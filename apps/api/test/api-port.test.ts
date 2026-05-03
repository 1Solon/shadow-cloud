import { describe, expect, it } from 'vitest';
import { resolveApiPort } from '../src/api-port';

describe('resolveApiPort', () => {
  it('prefers PORT for production-compatible hosting', () => {
    expect(resolveApiPort({ PORT: '3001', API_PORT: '3101' })).toBe(3001);
  });

  it('uses API_PORT for local pnpm dev configuration', () => {
    expect(resolveApiPort({ API_PORT: '3101' })).toBe(3101);
  });

  it('falls back to 3001 when no port is configured', () => {
    expect(resolveApiPort({})).toBe(3001);
  });
});
