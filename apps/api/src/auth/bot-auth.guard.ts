import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class BotAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const configuredToken = process.env.BOT_API_TOKEN;

    if (!configuredToken) {
      throw new UnauthorizedException('BOT_API_TOKEN is not configured.');
    }

    const providedToken = request.headers['x-shadow-cloud-bot-token'];

    if (
      typeof providedToken !== 'string' ||
      providedToken !== configuredToken
    ) {
      throw new UnauthorizedException('Invalid bot token.');
    }

    return true;
  }
}
