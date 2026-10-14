import { Inject, Injectable, Optional } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { AttachmentTokenStore } from './attachment-token-store.js';
import { serveAttachmentRequest } from '../../infrastructure/http/attachment-routes.js';
import { ATTACHMENT_STORE } from '../../runtime/tokens.js';
import type { AttachmentStore } from '../../shared/types.js';

@Injectable()
export class AttachmentRequestHandler {
  public constructor(
    @Optional()
    @Inject(ATTACHMENT_STORE)
    private readonly attachmentStore: AttachmentStore | undefined,
    @Inject(AttachmentTokenStore) private readonly attachmentTokens: AttachmentTokenStore,
  ) {}

  public handle(request: IncomingMessage, response: ServerResponse): boolean {
    return serveAttachmentRequest(
      request,
      response,
      this.attachmentStore,
      this.attachmentTokens.entries(),
    );
  }
}
