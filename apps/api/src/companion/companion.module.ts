import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { prisma } from '../database';
import { FileStorageService } from '../games/file-storage.service';
import { CompanionController } from './companion.controller';
import { CompanionService } from './companion.service';
@Module({
  imports: [AuthModule],
  controllers: [CompanionController],
  providers: [
    FileStorageService,
    {
      provide: CompanionService,
      inject: [FileStorageService],
      useFactory: (storage: FileStorageService) =>
        new CompanionService(prisma, storage),
    },
  ],
})
export class CompanionModule {}
