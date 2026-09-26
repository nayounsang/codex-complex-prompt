import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';

import { AttachmentTooLargeError, AttachmentValidationError } from '@codex-complex-prompt/protocol';

import { WebSocketServer } from 'ws';

import { SessionStore } from './features/session/storage/session-store.js';
import { attachConnection } from './features/session/connection/attach-connection.js';
import { serveStatic, resolveStaticPath } from './infrastructure/http/static-files.js';
import type {
  AttachmentStore,
  LocalBridgeServerOptions,
  RunningLocalBridgeServer,
} from './shared/types.js';

export { SessionStore } from './features/session/storage/session-store.js';
export type {
  SessionRecord,
  SessionStoreOptions,
} from './features/session/storage/session-store.js';
export type {
  LocalBridgeServerOptions,
  PromptAdapterResult,
  PromptContext,
  RunningLocalBridgeServer,
  TemplateStore,
  AttachmentStore,
} from './shared/types.js';
export { resolveStaticPath };

export async function startLocalBridgeServer(
  options: LocalBridgeServerOptions,
): Promise<RunningLocalBridgeServer> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  const promptTimeoutMs = options.promptTimeoutMs ?? 30_000;
  const maxConnections = options.maxConnections ?? 8;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5_000;
  validatePositiveInteger(promptTimeoutMs, 'Prompt timeout');
  validatePositiveInteger(maxConnections, 'Maximum connections');
  validatePositiveInteger(handshakeTimeoutMs, 'Handshake timeout');

  const sessionStore = new SessionStore(options);
  const attachmentTokens = new Map<string, string>();
  let attachmentUrl = '';
  const httpServer = createServer((request, response) => {
    const attachmentRequest = serveAttachmentRequest(
      request,
      response,
      options.attachmentStore,
      attachmentTokens,
    );
    if (attachmentRequest) return;
    void serveStatic(request, response, options.staticDir);
  });
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  registerWebSocketUpgrade(httpServer, webSocketServer, host);
  registerConnections(
    webSocketServer,
    sessionStore,
    options,
    {
      maxConnections,
      promptTimeoutMs,
      handshakeTimeoutMs,
    },
    attachmentTokens,
    () => attachmentUrl,
  );

  await listen(httpServer, host, port);
  const address = httpServer.address();
  /* c8 ignore next 4 -- listen() on a TCP server always returns an AddressInfo here. */
  if (address === null || typeof address === 'string') {
    throw new Error('The local bridge server did not expose a TCP address.');
  }
  attachmentUrl = `http://${host}:${address.port}/_complex-prompt/attachments`;

  return {
    host,
    port: address.port,
    url: `http://${host}:${address.port}`,
    createSession: () => {
      const session = sessionStore.create();
      if (options.attachmentStore !== undefined) {
        attachmentTokens.set(session.id, randomBytes(32).toString('base64url'));
      }
      return { id: session.id, token: session.token, expiresAt: session.expiresAt };
    },
    close: async () => {
      for (const webSocket of webSocketServer.clients) webSocket.terminate();
      await closeWebSocketServer(webSocketServer);
      await close(httpServer);
    },
  };
}

interface ConnectionLimits {
  readonly maxConnections: number;
  readonly promptTimeoutMs: number;
  readonly handshakeTimeoutMs: number;
}

function registerWebSocketUpgrade(
  httpServer: HttpServer,
  webSocketServer: WebSocketServer,
  host: string,
): void {
  httpServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${host}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request);
    });
  });
}

function registerConnections(
  webSocketServer: WebSocketServer,
  sessionStore: SessionStore,
  options: LocalBridgeServerOptions,
  limits: ConnectionLimits,
  attachmentTokens: Map<string, string>,
  getAttachmentUrl: () => string,
): void {
  let activeConnections = 0;
  webSocketServer.on('connection', (webSocket) => {
    if (activeConnections >= limits.maxConnections) {
      webSocket.close(1013, 'The bridge has reached its connection limit.');
      return;
    }
    activeConnections += 1;
    let released = false;
    const releaseConnection = (): void => {
      if (released) return;
      released = true;
      activeConnections -= 1;
    };
    webSocket.once('close', releaseConnection);
    webSocket.once('error', releaseConnection);
    attachConnection({
      webSocket,
      sessionStore,
      onPrompt: options.onPrompt,
      promptTimeoutMs: limits.promptTimeoutMs,
      handshakeTimeoutMs: limits.handshakeTimeoutMs,
      initialMarkdown: options.initialMarkdown,
      feedbackLoop: options.feedbackLoop ?? false,
      templateStore: options.templateStore,
      templatesError: options.templatesError,
      attachmentTokens: options.attachmentStore === undefined ? undefined : attachmentTokens,
      getAttachmentUrl,
    });
  });
}

function serveAttachmentRequest(
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
        let input: {
          id?: unknown;
          image?: unknown;
          png?: unknown;
          extension?: unknown;
          scene?: unknown;
        };
        try {
          const parsed: unknown = JSON.parse(body);
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new AttachmentValidationError('Invalid attachment request.');
          }
          input = parsed;
        } catch (error) {
          if (error instanceof AttachmentValidationError) throw error;
          throw new AttachmentValidationError(
            `Attachment request JSON is invalid: ${
              error instanceof Error ? error.message : 'unknown parse error'
            }`,
          );
        }
        if (
          (typeof input.image !== 'string' && typeof input.png !== 'string') ||
          typeof input.scene !== 'string' ||
          (input.id !== undefined && typeof input.id !== 'string') ||
          (input.extension !== undefined && typeof input.extension !== 'string')
        )
          throw new AttachmentValidationError('Invalid attachment request.');
        const extension =
          typeof input.extension === 'string'
            ? input.extension
            : typeof input.image === 'string'
              ? undefined
              : 'png';
        const id = await attachmentStore.save({
          ...(typeof input.id === 'string' ? { id: input.id } : {}),
          ...(typeof input.image === 'string'
            ? { image: input.image }
            : { png: input.png as string }),
          ...(extension === undefined ? {} : { extension }),
          scene: input.scene,
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
            const value: unknown = JSON.parse(scene);
            editable =
              value !== null &&
              typeof value === 'object' &&
              'elements' in value &&
              Array.isArray(value.elements);
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
  void attachmentStore
    .read(id, kind)
    .then((attachment) => {
      if (attachment === undefined) {
        response.writeHead(404).end();
        return;
      }
      const image = attachment.image ?? attachment.png;
      if (kind !== 'json' && image !== undefined) {
        response
          .writeHead(200, {
            'Content-Type':
              attachment.mimeType ?? (kind === 'png' ? 'image/png' : 'application/octet-stream'),
            'Cache-Control': 'no-store',
          })
          .end(image);
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

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive integer.`);
}

function listen(server: HttpServer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function close(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
