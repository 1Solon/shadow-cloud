import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { jwtVerify, type JWTPayload } from 'jose';
import type { Request } from 'express';

export type AuthenticatedRequest = Request & {
  user?: JWTPayload;
};

@Injectable()
export class AppAuthGuard implements CanActivate {
  private readonly encoder = new TextEncoder();

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    const authSecret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;

    if (!authSecret) {
      throw new UnauthorizedException('NEXTAUTH_SECRET is not configured.');
    }

    try {
      const { payload } = await jwtVerify(
        token,
        this.encoder.encode(authSecret),
        {
          algorithms: ['HS256'],
        },
      );

      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid bearer token.');
    }
  }
}
