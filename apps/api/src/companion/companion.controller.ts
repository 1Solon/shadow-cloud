import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpException,
  Param,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  CompanionAuthGuard,
  type CompanionAuthenticatedRequest,
} from '../auth/companion-auth.guard';
import { CompanionService } from './companion.service';
import { CompanionProtocolController } from './protocol.controller';

function authorize(request: CompanionAuthenticatedRequest, scope: string) {
  if (
    request.headers['x-companion-protocol'] !==
    new CompanionProtocolController().protocol().protocolVersion
  )
    throw new HttpException({ code: 'update-required' }, 426);
  if (!request.user?.sub || !request.user.scope.includes(scope))
    throw new ForbiddenException({ code: 'missing-scope' });
  return request.user.sub;
}
function integer(value: string | undefined) {
  if (
    value === undefined ||
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new BadRequestException({ code: 'invalid-request' });
  return Number(value);
}
@Controller('companion')
@UseGuards(CompanionAuthGuard)
export class CompanionController {
  constructor(private readonly companion: CompanionService) {}

  @Get('campaigns')
  @Header('Cache-Control', 'no-store')
  observe(@Req() request: CompanionAuthenticatedRequest) {
    return this.companion.observe(authorize(request, 'campaigns:observe'));
  }

  @Get('campaigns/:campaignId/publications')
  @Header('Cache-Control', 'no-store')
  publications(
    @Req() request: CompanionAuthenticatedRequest,
    @Param('campaignId') campaignId: string,
    @Query('after') after: string,
  ) {
    return this.companion.publications(
      authorize(request, 'campaigns:observe'),
      campaignId,
      integer(after),
    );
  }

  @Get('campaigns/:campaignId/saves/:fileId')
  @Header('Cache-Control', 'no-store')
  async download(
    @Req() request: CompanionAuthenticatedRequest,
    @Param('campaignId') campaignId: string,
    @Param('fileId') fileId: string,
    @Query('revision') revision: string,
    @Query('hash') hash: string,
  ) {
    const userId = authorize(request, 'saves:download');
    if (typeof hash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(hash))
      throw new BadRequestException({ code: 'invalid-request' });
    const content = await this.companion.download(
      userId,
      campaignId,
      fileId,
      integer(revision),
      hash,
    );
    return new StreamableFile(content, {
      type: 'application/octet-stream',
      length: content.length,
    });
  }
}
