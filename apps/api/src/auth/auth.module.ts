import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AppAuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { BotAuthGuard } from './bot-auth.guard';
import { InternalAuthGuard } from './internal-auth.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AppAuthGuard, BotAuthGuard, InternalAuthGuard],
  exports: [AuthService, AppAuthGuard, BotAuthGuard, InternalAuthGuard],
})
export class AuthModule {}
