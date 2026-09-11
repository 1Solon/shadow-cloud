import { Controller, Get, Header } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Both source and compiled modules have the same depth. The root manifest is
// copied into the API image and is also the Rust engine's compile-time source.
const release = JSON.parse(
  readFileSync(join(__dirname, '../../../../package.json'), 'utf8'),
) as { version: string };

@Controller('companion')
export class CompanionProtocolController {
  @Get('protocol')
  @Header('Cache-Control', 'no-store')
  protocol() {
    return { protocolVersion: release.version };
  }
}
