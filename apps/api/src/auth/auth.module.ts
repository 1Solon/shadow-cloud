import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AppAuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { BotAuthGuard } from './bot-auth.guard';
import { InternalAuthGuard } from './internal-auth.guard';
import { prisma } from '../database';
import { CompanionAuthController } from './companion-auth.controller';
import { DeviceSessionsService } from './device-sessions.service';
import { CompanionAuthGuard } from './companion-auth.guard';

@Module({
  controllers: [AuthController, CompanionAuthController],
  providers: [
    AuthService,
    AppAuthGuard,
    BotAuthGuard,
    InternalAuthGuard,
    {
      provide: DeviceSessionsService,
      useFactory: () => new DeviceSessionsService(prisma),
    },
    CompanionAuthGuard,
  ],
  exports: [
    AuthService,
    AppAuthGuard,
    BotAuthGuard,
    InternalAuthGuard,
    DeviceSessionsService,
    CompanionAuthGuard,
  ],
})
export class AuthModule {}
