import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return {
      service: 'shadow-cloud-api',
      status: 'ok',
      retentionLimit: 5,
    };
  }
}
