import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AttachmentRequestHandler } from './attachment-request-handler.js';

@Controller('_complex-prompt/attachments')
export class AttachmentController {
  public constructor(
    @Inject(AttachmentRequestHandler)
    private readonly attachmentRequestHandler: AttachmentRequestHandler,
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
    if (!this.attachmentRequestHandler.handle(request, response)) response.writeHead(404).end();
  }
}
