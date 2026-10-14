import { Module } from '@nestjs/common';

import { AttachmentController } from './attachment.controller.js';
import { AttachmentRequestHandler } from './attachment-request-handler.js';

@Module({
  controllers: [AttachmentController],
  providers: [AttachmentRequestHandler],
})
export class AttachmentModule {}
