import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { AttachmentTooLargeError } from '@codex-complex-prompt/protocol';

export function parseVideoRange(
  header: string | undefined,
  length: number,
): { readonly start: number; readonly end: number } | null {
  if (header === undefined) return { start: 0, end: length - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (match === null || length === 0) return null;
  const requestedStart = match[1] === '' ? undefined : Number(match[1]);
  const requestedEnd = match[2] === '' ? undefined : Number(match[2]);
  if (requestedStart === undefined && requestedEnd === undefined) return null;
  const start = requestedStart ?? Math.max(0, length - (requestedEnd ?? 0));
  const end =
    requestedStart === undefined ? length - 1 : Math.min(requestedEnd ?? length - 1, length - 1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end) {
    return null;
  }
  return { start, end };
}

export function isVideoExtension(extension: string): boolean {
  return extension === 'mp4' || extension === 'mov' || extension === 'webm';
}

export async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) {
      throw new AttachmentTooLargeError('The attachment request exceeds the request size limit.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function tokensEqual(expected: string, provided: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.byteLength === providedBytes.byteLength &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}
