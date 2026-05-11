import { describe, expect, it } from 'vitest';
import { parseThreadMessageTarget } from '../src/message-target';

const context = {
  guildId: '111111111111111111',
  channelId: '222222222222222222',
};

describe('parseThreadMessageTarget', () => {
  it('accepts a raw Discord message id', () => {
    expect(
      parseThreadMessageTarget('333333333333333333', context),
    ).toStrictEqual({
      ok: true,
      messageId: '333333333333333333',
    });
  });

  it('accepts a discord.com message URL from the current thread', () => {
    expect(
      parseThreadMessageTarget(
        'https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333',
        context,
      ),
    ).toStrictEqual({
      ok: true,
      messageId: '333333333333333333',
    });
  });

  it('accepts a discordapp.com message URL from the current thread', () => {
    expect(
      parseThreadMessageTarget(
        'https://discordapp.com/channels/111111111111111111/222222222222222222/333333333333333333',
        context,
      ),
    ).toStrictEqual({
      ok: true,
      messageId: '333333333333333333',
    });
  });

  it('rejects malformed message targets', () => {
    expect(parseThreadMessageTarget('not-a-message', context)).toStrictEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a message URL from another guild', () => {
    expect(
      parseThreadMessageTarget(
        'https://discord.com/channels/999999999999999999/222222222222222222/333333333333333333',
        context,
      ),
    ).toStrictEqual({
      ok: false,
      reason: 'wrong-guild',
    });
  });

  it('rejects a message URL from another thread', () => {
    expect(
      parseThreadMessageTarget(
        'https://discord.com/channels/111111111111111111/999999999999999999/333333333333333333',
        context,
      ),
    ).toStrictEqual({
      ok: false,
      reason: 'wrong-channel',
    });
  });
});
