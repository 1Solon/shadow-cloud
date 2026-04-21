import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BotNotificationsService } from './bot-notifications.service';
import { FileStorageService } from './file-storage.service';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { GamesQueryService } from './services/games-query.service';
import { GamesRegistrationService } from './services/games-registration.service';
import { GamesTurnService } from './services/games-turn.service';

@Module({
  imports: [AuthModule],
  controllers: [GamesController],
  providers: [
    GamesService,
    GamesQueryService,
    GamesRegistrationService,
    GamesTurnService,
    FileStorageService,
    BotNotificationsService,
  ],
})
export class GamesModule {}
