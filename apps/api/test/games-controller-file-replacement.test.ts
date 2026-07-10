import {
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { GamesController } from '../src/games/games.controller';
import { SaveFileUploadExceptionFilter } from '../src/games/support/save-file-upload-exception.filter';

vi.mock('../src/database', () => ({
  AuditEventType: {},
  prisma: {},
}));

const replacementFile = {
  buffer: Buffer.from([4, 5, 6]),
  originalname: 'corrected.se1',
  size: 3,
};

describe('GamesController replaceSave', () => {
  it('delegates an authenticated replacement with the shadow override claim as metadata', async () => {
    const gamesService = {
      replaceSave: vi.fn().mockResolvedValue({ replaced: true }),
    };
    const controller = new GamesController(gamesService as never);

    await expect(
      controller.replaceSave(
        '42',
        'version-7',
        { user: { sub: 'user-1', shadowOverrideEnabled: true } } as never,
        replacementFile,
        { contentHash: 'sha256:new' },
      ),
    ).resolves.toEqual({ replaced: true });

    expect(gamesService.replaceSave).toHaveBeenCalledWith(
      '42',
      'version-7',
      'user-1',
      replacementFile,
      { contentHash: 'sha256:new', shadowOverrideEnabled: true },
    );
  });

  it('rejects a replacement without an uploaded file', () => {
    const gamesService = { replaceSave: vi.fn() };
    const controller = new GamesController(gamesService as never);

    expect(() =>
      controller.replaceSave(
        '42',
        'version-7',
        { user: { sub: 'user-1' } } as never,
        undefined,
        {},
      ),
    ).toThrow(new BadRequestException('A replacement save file is required.'));
    expect(gamesService.replaceSave).not.toHaveBeenCalled();
  });
});

describe('SaveFileUploadExceptionFilter', () => {
  it('maps an oversized replacement upload to a bad request response', () => {
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const host = {
      switchToHttp: vi.fn().mockReturnValue({
        getResponse: vi.fn().mockReturnValue(response),
      }),
    };

    new SaveFileUploadExceptionFilter().catch(
      new PayloadTooLargeException(),
      host as never,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 400,
      message: 'The replacement save exceeds 25 MB.',
      error: 'Bad Request',
    });
  });
});
