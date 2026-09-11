import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { InternalAuthGuard } from './internal-auth.guard';
import { DeviceSessionsService } from './device-sessions.service';

@Controller('auth')
export class CompanionAuthController {
  constructor(private readonly deviceSessions: DeviceSessionsService) {}

  @Post('companion-handoffs')
  createHandoff() {
    return this.deviceSessions.createHandoff();
  }

  @Post('companion-handoffs/:handoffId/approve')
  @UseGuards(InternalAuthGuard)
  approveHandoff(
    @Param('handoffId') handoffId: string,
    @Body() input: { userId?: string | null } = {},
  ) {
    return this.deviceSessions.approveHandoff(handoffId, input.userId ?? '');
  }

  @Post('device-sessions/exchange')
  exchangeHandoff(
    @Body()
    input: { handoffId: string; pollSecret: string } | { handoffToken: string },
  ) {
    return this.deviceSessions.exchangeHandoff(input);
  }

  @Post('device-sessions/refresh')
  refresh(@Body() input: { refreshToken?: string | null } = {}) {
    return this.deviceSessions.refresh(input.refreshToken ?? '');
  }

  @Post('device-sessions/revoke')
  revoke(@Body() input: { refreshToken?: string | null } = {}) {
    return this.deviceSessions.revoke(input.refreshToken ?? '');
  }
}
