import { expect, it, vi } from 'vitest';
import { GamesController } from '../src/games/games.controller';
import { GamesService } from '../src/games/games.service';

vi.mock('../src/database', () => ({ AuditEventType: {}, prisma: {} }));

it.each([true, false, undefined, 'true'])(
  'propagates only literal enabled intent through controller and facade: %s',
  async (claim) => {
    const files = {
      inspectLatestSave: vi.fn(),
      resetPassword: vi.fn(),
      getPasswordResetRecovery: vi.fn(),
      undoPasswordReset: vi.fn(),
    };
    const facade = new GamesService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      files as never,
      {} as never,
    );
    const controller = new GamesController(facade);
    const request = {
      user: { sub: 'actor', shadowOverrideEnabled: claim },
      headers: { 'x-shadow-override': 'true' },
    } as never;
    const input = { confirmed: true } as never;
    await controller.inspectLatestSave('1', request);
    await controller.resetPassword('1', request, input);
    await controller.getPasswordResetRecovery('1', request);
    await controller.undoPasswordReset('1', request, input);
    expect(files.inspectLatestSave).toHaveBeenCalledWith(
      '1',
      'actor',
      claim === true,
    );
    expect(files.resetPassword).toHaveBeenCalledWith(
      '1',
      'actor',
      input,
      claim === true,
    );
    expect(files.getPasswordResetRecovery).toHaveBeenCalledWith(
      '1',
      'actor',
      claim === true,
    );
    expect(files.undoPasswordReset).toHaveBeenCalledWith(
      '1',
      'actor',
      input,
      claim === true,
    );
  },
);
