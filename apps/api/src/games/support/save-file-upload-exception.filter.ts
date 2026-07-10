import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch(PayloadTooLargeException)
export class SaveFileUploadExceptionFilter implements ExceptionFilter<PayloadTooLargeException> {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    host.switchToHttp().getResponse<Response>().status(400).json({
      statusCode: 400,
      message: 'The replacement save exceeds 25 MB.',
      error: 'Bad Request',
    });
  }
}
