import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
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

  @Post('desktop-handoffs')
  createDesktopAuthHandoff() {
    return this.authService.createDesktopAuthHandoff();
  }

  @Post('desktop-handoffs/:handoffId/poll')
  pollDesktopAuthHandoff(
    @Param('handoffId') handoffId: string,
    @Body() input: { pollSecret?: string | null } = {},
  ) {
    return this.authService.pollDesktopAuthHandoff({
      handoffId,
      pollSecret: input.pollSecret,
    });
  }

  @Post('desktop-handoffs/:handoffId/approve')
  @UseGuards(InternalAuthGuard)
  approveDesktopAuthHandoff(
    @Param('handoffId') handoffId: string,
    @Body()
    input: {
      userId: string;
      email?: string | null;
      displayName?: string | null;
      avatarUrl?: string | null;
    },
  ) {
    return this.authService.approveDesktopAuthHandoff(handoffId, input);
  }
}
