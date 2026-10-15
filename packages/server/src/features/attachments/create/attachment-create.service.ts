import { Inject, Injectable, Optional } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AttachmentTooLargeError, AttachmentValidationError } from '@codex-complex-prompt/protocol';
import { omitBy } from 'es-toolkit';
import { ATTACHMENT_STORE } from '../../../runtime/tokens.js';
import type { AttachmentStore } from '../../../shared/types.js';
import {
  CreateAttachmentDtoSchema,
  type CreateAttachmentDto,
} from './dto/create-attachment.dto.js';
import { CreateAttachmentResponseDtoSchema } from './dto/create-attachment-response.dto.js';
import { readRequestBody } from './request-body.js';

function toAttachmentStoreInput(
  input: CreateAttachmentDto,
  extension: string | undefined,
): Parameters<AttachmentStore['save']>[0] {
  return omitBy(
    {
      id: input.id,
      video: input.video,
      image: input.image,
      png: input.image === undefined && input.video === undefined ? input.png : undefined,
      extension,
      scene: input.scene,
    },
    (value) => value === undefined,
  ) as Parameters<AttachmentStore['save']>[0];
}

@Injectable()
export class AttachmentCreateService {
  public constructor(
    @Optional()
    @Inject(ATTACHMENT_STORE)
    private readonly attachmentStore: AttachmentStore | undefined,
  ) {}

  public handle(request: IncomingMessage, response: ServerResponse): void {
    const attachmentStore = this.attachmentStore;
    if (attachmentStore === undefined) {
      response.writeHead(404).end();
      return;
    }

    void readRequestBody(request, 36 * 1024 * 1024)
      .then(async (body) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch (error) {
          throw new AttachmentValidationError(
            `Attachment request JSON is invalid: ${
              error instanceof Error ? error.message : 'unknown parse error'
            }`,
          );
        }
        const result = CreateAttachmentDtoSchema.safeParse(parsed);
        if (!result.success) throw new AttachmentValidationError('Invalid attachment request.');
        const input = result.data;
        const extension = input.extension ?? (input.image !== undefined ? undefined : 'png');
        const id = await attachmentStore.save(toAttachmentStoreInput(input, extension));
        return CreateAttachmentResponseDtoSchema.parse({ id });
      })
      .then((result) =>
        response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify(result)),
      )
      .catch((error: unknown) => {
        const isTooLarge = error instanceof AttachmentTooLargeError;
        const isInvalidRequest = error instanceof AttachmentValidationError;
        const status = isTooLarge ? 413 : isInvalidRequest ? 400 : 500;
        const message =
          isTooLarge || isInvalidRequest ? error.message : 'Attachment could not be saved.';
        response
          .writeHead(status, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: message }));
      });
  }
}
