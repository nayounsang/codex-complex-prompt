import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AttachmentCreateRequestSchema,
  AttachmentTooLargeError,
  AttachmentValidationError,
  DrawingSceneSchema,
} from '@codex-complex-prompt/protocol';
import type { AttachmentStore } from '../../shared/types.js';

export function serveAttachmentRequest(
  request: IncomingMessage,
  response: ServerResponse,
  attachmentStore: AttachmentStore | undefined,
  attachmentTokens: Map<string, string>,
): boolean {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (!url.pathname.startsWith('/_complex-prompt/attachments')) return false;
  const origin = request.headers.origin;
  if (origin !== undefined && isLoopbackOrigin(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Expose-Headers', 'X-Attachment-Editable');
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return true;
  }
  if (attachmentStore === undefined) {
    response.writeHead(404).end();
    return true;
  }
  const suppliedToken = url.searchParams.get('token') ?? '';
  const sessionId = [...attachmentTokens].find(([, token]) =>
    tokensEqual(token, suppliedToken),
  )?.[0];
  if (sessionId === undefined) {
    response
      .writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end('Invalid attachment token.');
    return true;
  }
  const suffix = url.pathname.slice('/_complex-prompt/attachments'.length);
  const match = suffix.match(/^(?:\/([0-9a-f-]{36})(?:\.([a-z0-9]+))?)?\/?$/i);
  if (match === null) {
    response.writeHead(404).end();
    return true;
  }
  if (request.method === 'POST' && match[1] === undefined) {
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
    return true;
  }
  const id = match[1];
  const kind = match[2];
  if (id === undefined || !['GET', 'HEAD', 'DELETE'].includes(request.method ?? '')) {
    response.writeHead(405).end();
    return true;
  }
  if (request.method === 'HEAD') {
    if (
      kind !== undefined &&
      isVideoExtension(kind) &&
      attachmentStore.getVideoInfo !== undefined
    ) {
      void attachmentStore
        .getVideoInfo(id, kind)
        .then((info) => {
          if (info === undefined) {
            response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
            return;
          }
          const range = parseVideoRange(request.headers.range, info.size);
          if (range === null) {
            response
              .writeHead(416, {
                'Accept-Ranges': 'bytes',
                'Content-Range': `bytes */${info.size}`,
                'Cache-Control': 'no-store',
              })
              .end();
            return;
          }
          const partial = request.headers.range !== undefined;
          response
            .writeHead(partial ? 206 : 200, {
              'Content-Type': info.mimeType,
              'Content-Length': String(range.end - range.start + 1),
              'Accept-Ranges': 'bytes',
              ...(partial
                ? { 'Content-Range': `bytes ${range.start}-${range.end}/${info.size}` }
                : {}),
              'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
            })
            .end();
        })
        .catch(() => response.writeHead(500).end());
      return true;
    }
    if (kind === 'json' && attachmentStore.readScene !== undefined) {
      void attachmentStore
        .readScene(id)
        .then((scene) => {
          if (scene === undefined) {
            response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
            return;
          }
          let editable = false;
          try {
            editable = DrawingSceneSchema.safeParse(JSON.parse(scene)).success;
          } catch {
            editable = false;
          }
          response
            .writeHead(200, {
              'Cache-Control': 'no-store',
              'X-Attachment-Editable': String(editable),
            })
            .end();
        })
        .catch(() => response.writeHead(500).end());
      return true;
    }
    void attachmentStore
      .hasSceneData(id)
      .then((exists) =>
        response.writeHead(exists ? 200 : 404, { 'Cache-Control': 'no-store' }).end(),
      )
      .catch(() => response.writeHead(500).end());
    return true;
  }
  if (request.method === 'DELETE') {
    void attachmentStore
      .delete(id)
      .then((deleted) => response.writeHead(deleted ? 204 : 404).end())
      .catch(() => response.writeHead(500).end());
    return true;
  }
  if (request.method === 'GET' && kind === undefined) {
    response.writeHead(400).end();
    return true;
  }
  if (kind === 'json' && attachmentStore.readScene !== undefined) {
    void attachmentStore
      .readScene(id)
      .then((scene) => {
        if (scene === undefined) {
          response.writeHead(404).end();
          return;
        }
        response
          .writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          })
          .end(scene);
      })
      .catch(() => response.writeHead(500).end());
    return true;
  }
  if (
    kind !== undefined &&
    isVideoExtension(kind) &&
    attachmentStore.getVideoInfo !== undefined &&
    attachmentStore.readVideoRange !== undefined
  ) {
    void attachmentStore
      .getVideoInfo(id, kind)
      .then(async (info) => {
        if (info === undefined) {
          response.writeHead(404).end();
          return;
        }
        const range = parseVideoRange(request.headers.range, info.size);
        if (range === null) {
          response
            .writeHead(416, {
              'Accept-Ranges': 'bytes',
              'Content-Range': `bytes */${info.size}`,
              'Cache-Control': 'no-store',
            })
            .end();
          return;
        }
        const chunk = await attachmentStore.readVideoRange?.(
          id,
          kind,
          range.start,
          range.end,
          info.size,
        );
        if (chunk === undefined) {
          response.writeHead(404).end();
          return;
        }
        const partial = request.headers.range !== undefined;
        response
          .writeHead(partial ? 206 : 200, {
            'Content-Type': info.mimeType,
            'Content-Length': String(chunk.byteLength),
            'Accept-Ranges': 'bytes',
            ...(partial
              ? { 'Content-Range': `bytes ${range.start}-${range.end}/${info.size}` }
              : {}),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
          })
          .end(chunk);
      })
      .catch(() => response.writeHead(500).end());
    return true;
  }
  void attachmentStore
    .read(id, kind)
    .then((attachment) => {
      if (attachment === undefined) {
        response.writeHead(404).end();
        return;
      }
      const media = attachment.video ?? attachment.image ?? attachment.png;
      if (kind !== 'json' && media !== undefined) {
        if (attachment.video !== undefined) {
          const range = parseVideoRange(request.headers.range, attachment.video.byteLength);
          if (range === null) {
            response
              .writeHead(416, {
                'Accept-Ranges': 'bytes',
                'Content-Range': `bytes */${attachment.video.byteLength}`,
                'Cache-Control': 'no-store',
              })
              .end();
            return;
          }
          const { start, end } = range;
          const chunk = attachment.video.subarray(start, end + 1);
          response
            .writeHead(request.headers.range === undefined ? 200 : 206, {
              'Content-Type': attachment.mimeType ?? 'application/octet-stream',
              'Content-Length': String(chunk.byteLength),
              'Accept-Ranges': 'bytes',
              ...(request.headers.range === undefined
                ? {}
                : { 'Content-Range': `bytes ${start}-${end}/${attachment.video.byteLength}` }),
              'Cache-Control': 'no-store',
              'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
            })
            .end(chunk);
          return;
        }
        response
          .writeHead(200, {
            'Content-Type':
              attachment.mimeType ?? (kind === 'png' ? 'image/png' : 'application/octet-stream'),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
          })
          .end(media);
        return;
      }
      if (kind === 'json' && attachment.scene !== undefined) {
        response
          .writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          })
          .end(attachment.scene);
        return;
      }
      response.writeHead(400).end();
    })
    .catch(() => response.writeHead(500).end());
  return true;
}

function parseVideoRange(
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

function isVideoExtension(extension: string): boolean {
  return extension === 'mp4' || extension === 'mov' || extension === 'webm';
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
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

function tokensEqual(expected: string, provided: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return (
    expectedBytes.byteLength === providedBytes.byteLength &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}
