import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AttachmentService } from './attachment.service.js';

@Controller('_complex-prompt/attachments')
export class AttachmentController {
  public constructor(
    @Inject(AttachmentService) private readonly attachmentService: AttachmentService,
  ) {}

  @All()
  public handleCollection(@Req() request: IncomingMessage, @Res() response: ServerResponse): void {
    this.handleRequest(request, response);
  }

  @All('{*path}')
  public handleAttachment(@Req() request: IncomingMessage, @Res() response: ServerResponse): void {
    this.handleRequest(request, response);
  }

  private handleRequest(request: IncomingMessage, response: ServerResponse): void {
    if (!this.attachmentService.handle(request, response)) response.writeHead(404).end();
  }
}
