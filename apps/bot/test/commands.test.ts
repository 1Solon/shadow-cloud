import { describe, expect, it } from 'vitest';
import {
  isSupportedCommandName,
  slashCommands,
  supportedCommandNames,
} from '../src/commands';

describe('commands', () => {
  it('recognizes every exported supported command name', () => {
    expect(supportedCommandNames.every(isSupportedCommandName)).toBe(true);
  });

  it('rejects unsupported command names', () => {
    expect(isSupportedCommandName('unknown')).toBe(false);
  });

  it('keeps slash command definitions aligned with supported command names', () => {
    expect(slashCommands.map((command) => command.name)).toEqual(
      supportedCommandNames,
    );
  });

  it('includes host-only pinning commands after link', () => {
    expect(supportedCommandNames).toEqual([
      'init',
      'register',
      'resign',
      'replace',
      'skip',
      'link',
      'pin',
      'unpin',
    ]);
  });
});
