import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AppAuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { BotAuthGuard } from '../auth/bot-auth.guard';
import { CreateDiscordGameDto } from './dto/create-discord-game.dto';
import { RegisterDiscordPlayerDto } from './dto/register-discord-player.dto';
import { ReorderSeatOrderDto } from './dto/reorder-seat-order.dto';
import { ReplaceDiscordPlayerDto } from './dto/replace-discord-player.dto';
import { ResignDiscordPlayerDto } from './dto/resign-discord-player.dto';
import { SkipDiscordPlayerDto } from './dto/skip-discord-player.dto';
import { TransferHostDto } from './dto/transfer-host.dto';
import { UpdateGameMetadataDto } from './dto/update-game-metadata.dto';
import { ApproveRegistrationRequestDto } from './dto/approve-registration-request.dto';
import { GamesService, type UploadedSaveFile } from './games.service';

@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  listGames() {
    return this.gamesService.listGames();
  }

  @Get(':gameId/detail')
  getDetail(@Param('gameId') gameId: string) {
    return this.gamesService.getGameDetail(gameId);
  }

  @Get(':gameId/status')
  @UseGuards(AppAuthGuard)
  getStatus(
    @Param('gameId') gameId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.gamesService.getGameStatus(gameId, request.user?.sub);
  }

  @Post(':gameId/files')
  @UseGuards(AppAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: Number(
          process.env.SHADOW_CLOUD_MAX_SAVE_SIZE_BYTES ?? 25 * 1024 * 1024,
        ),
      },
    }),
  )
  uploadSave(
    @Param('gameId') gameId: string,
    @Req() request: AuthenticatedRequest,
    @UploadedFile() file?: UploadedSaveFile,
  ) {
    if (!file?.buffer?.length || !file.originalname) {
      throw new BadRequestException('A save file upload is required.');
    }

    return this.gamesService.uploadSave(gameId, request.user?.sub, file);
  }

  @Post(':gameId/seat-order')
  @UseGuards(AppAuthGuard)
  reorderSeatOrder(
    @Param('gameId') gameId: string,
    @Req() request: AuthenticatedRequest,
    @Body() input: ReorderSeatOrderDto,
  ) {
    return this.gamesService.reorderSeatOrder(gameId, request.user?.sub, input);
  }

  @Post(':gameId/transfer-host')
  @UseGuards(AppAuthGuard)
  transferHost(
    @Param('gameId') gameId: string,
    @Req() request: AuthenticatedRequest,
    @Body() input: TransferHostDto,
  ) {
    return this.gamesService.transferHost(gameId, request.user?.sub, input);
  }

  @Patch(':gameId/metadata')
  @UseGuards(AppAuthGuard)
  updateMetadata(
    @Param('gameId') gameId: string,
    @Req() request: AuthenticatedRequest,
    @Body() input: UpdateGameMetadataDto,
  ) {
    return this.gamesService.updateGameMetadata(
      gameId,
      request.user?.sub,
      input,
    );
  }

  @Get(':gameId/files/:fileVersionId')
  @UseGuards(AppAuthGuard)
  async downloadSave(
    @Param('gameId') gameId: string,
    @Param('fileVersionId') fileVersionId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const download = await this.gamesService.downloadSave(
      gameId,
      fileVersionId,
      request.user?.sub,
    );

    response.setHeader('content-type', 'application/octet-stream');
    response.setHeader(
      'content-disposition',
      `attachment; filename="${encodeURIComponent(download.originalName)}"`,
    );
    response.setHeader('content-length', String(download.size));
    response.setHeader('last-modified', download.lastModified.toUTCString());

    return new StreamableFile(download.stream);
  }

  @Post('init')
  @UseGuards(BotAuthGuard)
  createFromDiscord(@Body() input: CreateDiscordGameDto) {
    return this.gamesService.createGameFromDiscordInit(input);
  }

  @Post('register')
  @UseGuards(BotAuthGuard)
  registerFromDiscord(@Body() input: RegisterDiscordPlayerDto) {
    return this.gamesService.registerPlayerFromDiscord(input);
  }

  @Post('resign')
  @UseGuards(BotAuthGuard)
  resignFromDiscord(@Body() input: ResignDiscordPlayerDto) {
    return this.gamesService.resignPlayerFromDiscord(input);
  }

  @Post('replace')
  @UseGuards(BotAuthGuard)
  replacePlayerInSeat(@Body() input: ReplaceDiscordPlayerDto) {
    return this.gamesService.replacePlayerInSeat(input);
  }

  @Post('skip')
  @UseGuards(BotAuthGuard)
  skipPlayerTurn(@Body() input: SkipDiscordPlayerDto) {
    return this.gamesService.skipPlayerTurn(input);
  }

  @Post('registration-requests/:requestId/approve')
  @UseGuards(BotAuthGuard)
  approveRegistration(
    @Param('requestId') requestId: string,
    @Body() input: ApproveRegistrationRequestDto,
  ) {
    return this.gamesService.approveRegistrationRequest(
      requestId,
      input.discordMessageId,
      input.approverDiscordId,
    );
  }

  @Post('registration-requests/:requestId/reject')
  @UseGuards(BotAuthGuard)
  rejectRegistration(
    @Param('requestId') requestId: string,
    @Body() input: ApproveRegistrationRequestDto,
  ) {
    return this.gamesService.rejectRegistrationRequest(
      requestId,
      input.discordMessageId,
      input.approverDiscordId,
    );
  }
}
