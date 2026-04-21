import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { jwtVerify } from 'jose';
import type { Request } from 'express';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  private readonly encoder = new TextEncoder();

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const configuredSecret =
      process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;

    if (!configuredSecret) {
      throw new UnauthorizedException('NEXTAUTH_SECRET is not configured.');
    }

    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing internal bearer token.');
    }

    try {
      await jwtVerify(token, this.encoder.encode(configuredSecret), {
        algorithms: ['HS256'],
        audience: 'shadow-cloud-internal',
        issuer: 'shadow-cloud-web',
        subject: 'discord-identity-sync',
      });
    } catch {
      throw new UnauthorizedException('Invalid internal bearer token.');
    }

    return true;
  }
}
