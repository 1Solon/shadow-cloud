import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { prisma } from '../database';
import { BotNotificationsService } from './bot-notifications.service';
import { FileStorageService } from './file-storage.service';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { GamesFileService } from './services/games-file.service';
import { GamesQueryService } from './services/games-query.service';
import { GamesRegistrationService } from './services/games-registration.service';
import { TurnRecordsService } from './services/turn-records.service';
import { TurnRemindersService } from './services/turn-reminders.service';
import { GamesTurnService } from './services/games-turn.service';
import { TurnMutationsService } from './services/turn-mutations.service';

@Module({
  imports: [AuthModule],
  controllers: [GamesController],
  providers: [
    GamesService,
    GamesFileService,
    GamesQueryService,
    GamesRegistrationService,
    TurnRecordsService,
    {
      provide: TurnMutationsService,
      useFactory: (
        turnRecords: TurnRecordsService,
        authService: AuthService,
        fileStorage: FileStorageService,
        botNotifications: BotNotificationsService,
      ) =>
        new TurnMutationsService(prisma, turnRecords, {
          authService,
          fileStorage,
          botNotifications,
        }),
      inject: [
        TurnRecordsService,
        AuthService,
        FileStorageService,
        BotNotificationsService,
      ],
    },
    TurnRemindersService,
    GamesTurnService,
    FileStorageService,
    BotNotificationsService,
  ],
})
export class GamesModule {}
