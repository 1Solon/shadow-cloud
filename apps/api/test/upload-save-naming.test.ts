import { describe, expect, it } from 'vitest';
import { resolveUploadSaveNaming } from '../src/games/support/upload-save-naming';

describe('resolveUploadSaveNaming', () => {
  it('uses the next active player for uploaded save filenames', () => {
    const players = [
      {
        id: 'entry-1',
        userId: 'user-1',
        displayName: 'Player1',
        turnOrder: 1,
        isOrganizer: true,
      },
      {
        id: 'entry-2',
        userId: 'user-2',
        displayName: 'Player2',
        turnOrder: 2,
        isOrganizer: false,
      },
    ];

    const naming = resolveUploadSaveNaming(players, 'entry-1');

    expect(naming).toMatchObject({
      seat: 2,
      playerName: 'Player2',
      nextActivePlayer: {
        id: 'entry-2',
        userId: 'user-2',
        displayName: 'Player2',
        turnOrder: 2,
      },
    });
  });

  it('wraps back to seat one when the last player uploads', () => {
    const players = [
      {
        id: 'entry-1',
        userId: 'user-1',
        displayName: 'Player1',
        turnOrder: 1,
        isOrganizer: true,
      },
      {
        id: 'entry-2',
        userId: 'user-2',
        displayName: 'Player2',
        turnOrder: 2,
        isOrganizer: false,
      },
      {
        id: 'entry-3',
        userId: 'user-3',
        displayName: 'Player3',
        turnOrder: 3,
        isOrganizer: false,
      },
    ];

    const naming = resolveUploadSaveNaming(players, 'entry-3');

    expect(naming).toMatchObject({
      seat: 1,
      playerName: 'Player1',
      nextActivePlayer: {
        id: 'entry-1',
        userId: 'user-1',
        displayName: 'Player1',
        turnOrder: 1,
      },
    });
  });
});