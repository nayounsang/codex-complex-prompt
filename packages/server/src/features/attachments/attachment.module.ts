import { Module } from '@nestjs/common';

import { AttachmentCreateService } from './create/attachment-create.service.js';
import { AttachmentController } from './attachment.controller.js';
import { AttachmentService } from './attachment.service.js';
import { AttachmentTokenStore } from './store/attachment-token.store.js';

@Module({
  controllers: [AttachmentController],
  providers: [AttachmentService, AttachmentCreateService, AttachmentTokenStore],
  exports: [AttachmentTokenStore],
})
export class AttachmentModule {}
