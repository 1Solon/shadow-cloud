import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { InternalAuthGuard } from './internal-auth.guard';
import { AuthService } from './auth.service';
import { SyncDiscordIdentityDto } from './dto/sync-discord-identity.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('discord/sync')
  @UseGuards(InternalAuthGuard)
  syncDiscordIdentity(@Body() input: SyncDiscordIdentityDto) {
    return this.authService.syncDiscordIdentity(input);
  }
}
