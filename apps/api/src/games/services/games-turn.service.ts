import { Injectable } from '@nestjs/common';
import type { ReorderSeatOrderDto } from '../dto/reorder-seat-order.dto';
import type { ReplaceDiscordPlayerDto } from '../dto/replace-discord-player.dto';
import type { ResignDiscordPlayerDto } from '../dto/resign-discord-player.dto';
import type { SkipDiscordPlayerDto } from '../dto/skip-discord-player.dto';
import type { TransferHostDto } from '../dto/transfer-host.dto';
import type {
  UploadedSaveFile,
  UploadSaveSafetyMetadata,
} from '../support/game-payload.types';
import type { RejectSaveInput } from './turn-mutations/rejection';
import type { DesignateVictoryDto } from '../dto/designate-victory.dto';
import type { UndoVictoryDto } from '../dto/undo-victory.dto';
import { TurnMutationsService } from './turn-mutations.service';

@Injectable()
export class GamesTurnService {
  constructor(private readonly turnMutations: TurnMutationsService) {}

  async uploadSave(
    gameId: string,
    userId: string | undefined,
    file: UploadedSaveFile,
    metadata: UploadSaveSafetyMetadata = {},
  ) {
    return this.turnMutations.uploadSave(gameId, userId, file, metadata);
  }

  async rejectSave(userId: string | undefined, input: RejectSaveInput) {
    return this.turnMutations.rejectSave(userId, input);
  }

  async reorderSeatOrder(
    gameId: string,
    userId: string | undefined,
    input: ReorderSeatOrderDto,
  ) {
    return this.turnMutations.reorderSeatOrder(gameId, userId, input);
  }

  async replacePlayerInSeat(input: ReplaceDiscordPlayerDto) {
    return this.turnMutations.replacePlayerInSeat(input);
  }

  async transferHost(
    gameId: string,
    userId: string | undefined,
    input: TransferHostDto,
  ) {
    return this.turnMutations.transferHost(gameId, userId, input);
  }

  async resignPlayerFromDiscord(input: ResignDiscordPlayerDto) {
    return this.turnMutations.resignPlayerFromDiscord(input);
  }

  async skipPlayerTurn(input: SkipDiscordPlayerDto) {
    return this.turnMutations.skipPlayerTurn(input);
  }

  async designateVictory(input: DesignateVictoryDto, preview = false) {
    return this.turnMutations.designateVictory(input, { preview });
  }

  async undoVictory(input: UndoVictoryDto, preview = false) {
    return this.turnMutations.undoVictory(input, { preview });
  }
}
