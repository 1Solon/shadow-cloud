import { UnauthorizedException } from '@nestjs/common';
import { SignJWT } from 'jose';
import { beforeEach, expect, it } from 'vitest';
import { AppAuthGuard } from '../src/auth/auth.guard';

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = 'guard-secret';
  delete process.env.AUTH_SECRET;
});

it('never admits a scoped Companion access token to website API routes', async () => {
  const token = await new SignJWT({
    tokenUse: 'companion-access',
    deviceSessionId: 'device-1',
    scope: ['campaigns:observe', 'saves:download', 'turns:submit'],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer('shadow-cloud-api')
    .setAudience('shadow-cloud-companion')
    .setSubject('user-1')
    .sign(new TextEncoder().encode('guard-secret'));
  const request = { headers: { authorization: `Bearer ${token}` } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  };

  await expect(
    new AppAuthGuard().canActivate(context as never),
  ).rejects.toBeInstanceOf(UnauthorizedException);
});
