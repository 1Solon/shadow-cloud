import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  DeviceSessionsService,
  type CompanionAccessPayload,
} from './device-sessions.service';

export type CompanionAuthenticatedRequest = Request & {
  user?: CompanionAccessPayload;
};

@Injectable()
export class CompanionAuthGuard implements CanActivate {
  constructor(private readonly deviceSessions: DeviceSessionsService) {}

  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<CompanionAuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing Companion bearer token.');
    }
    request.user = await this.deviceSessions.verifyAccessToken(token);
    return true;
  }
}
