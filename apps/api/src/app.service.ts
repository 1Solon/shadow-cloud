import { Injectable } from '@nestjs/common';
import { resolveSaveRetentionLimit } from './games/support/save-retention';

@Injectable()
export class AppService {
  getHealth() {
    return {
      service: 'shadow-cloud-api',
      status: 'ok',
      retentionLimit: resolveSaveRetentionLimit(),
    };
  }
}
