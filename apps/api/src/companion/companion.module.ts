import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { prisma } from '../database';
import { FileStorageService } from '../games/file-storage.service';
import { CompanionController } from './companion.controller';
import { CompanionService } from './companion.service';
import { GamesModule } from '../games/games.module';
import { TurnMutationsService } from '../games/services/turn-mutations.service';
@Module({
  imports: [AuthModule, GamesModule],
  controllers: [CompanionController],
  providers: [
    FileStorageService,
    {
      provide: CompanionService,
      inject: [FileStorageService, TurnMutationsService],
      useFactory: (
        storage: FileStorageService,
        mutations: TurnMutationsService,
      ) => new CompanionService(prisma, storage, mutations),
    },
  ],
})
export class CompanionModule {}
