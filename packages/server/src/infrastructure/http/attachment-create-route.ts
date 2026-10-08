import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AttachmentCreateRequestSchema,
  AttachmentTooLargeError,
  AttachmentValidationError,
} from '@codex-complex-prompt/protocol';
import type { AttachmentStore } from '../../shared/types.js';
import { readRequestBody } from './attachment-route-utils.js';

export function handleAttachmentCreateRequest(
  request: IncomingMessage,
  response: ServerResponse,
  attachmentStore: AttachmentStore,
): void {
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
      const result = AttachmentCreateRequestSchema.safeParse(parsed);
      if (!result.success) throw new AttachmentValidationError('Invalid attachment request.');
      const input = result.data;
      const extension = input.extension ?? (input.image !== undefined ? undefined : 'png');
      const id = await attachmentStore.save({
        ...(input.id === undefined ? {} : { id: input.id }),
        ...(input.video === undefined ? {} : { video: input.video }),
        ...(input.image !== undefined
          ? { image: input.image }
          : input.video !== undefined
            ? {}
            : input.png === undefined
              ? {}
              : { png: input.png }),
        ...(extension === undefined ? {} : { extension }),
        ...(input.scene === undefined ? {} : { scene: input.scene }),
      });
      return id;
    })
    .then((id) =>
      response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id })),
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
