import type { IncomingMessage } from 'node:http';
import getRawBody from 'raw-body';
import { AttachmentTooLargeError } from '@codex-complex-prompt/protocol';

export async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  try {
    return await getRawBody(request, { limit: maxBytes, encoding: 'utf8' });
  } catch (error) {
    if (isPayloadTooLarge(error)) {
      throw new AttachmentTooLargeError('The attachment request exceeds the request size limit.');
    }
    throw error;
  }
}

function isPayloadTooLarge(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return 'statusCode' in error && error.statusCode === 413;
}
