import { createReadStream } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { stat } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import { extname, resolve, sep } from 'node:path';

import {
  ClientMessageSchema,
  encodeServerMessage,
  type PromptSubmit,
  type PromptSubmitMode,
  type PromptTemplate,
  type TemplateRequest,
  type ServerMessage,
} from '@codex-complex-prompt/protocol';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import { SessionStore, type SessionStoreOptions } from './session-store.js';

export { SessionStore } from './session-store.js';
export type { SessionRecord, SessionStoreOptions } from './session-store.js';

export interface PromptContext {
  readonly sessionId: string;
  readonly submissionId: string;
  readonly mode: PromptSubmitMode;
}

export type PromptAdapterResult = string | void;

export interface TemplateStore {
  readonly list: () => Promise<readonly PromptTemplate[]>;
  readonly save: (template: PromptTemplate) => Promise<readonly PromptTemplate[]>;
  readonly delete: (id: string) => Promise<readonly PromptTemplate[]>;
}

export interface AttachmentStore {
  readonly save: (input: { id?: string; png: string; scene: string }) => Promise<string>;
  readonly read: (
    id: string,
  ) => Promise<{ readonly png: Buffer; readonly scene: string } | undefined>;
  readonly hasSceneData: (id: string) => Promise<boolean>;
  readonly delete: (id: string) => Promise<boolean>;
}

export interface LocalBridgeServerOptions extends SessionStoreOptions {
  readonly host?: string;
  readonly port?: number;
  readonly staticDir?: string;
  readonly promptTimeoutMs?: number;
  readonly maxConnections?: number;
  readonly handshakeTimeoutMs?: number;
  readonly initialMarkdown?: string;
  readonly feedbackLoop?: boolean;
  readonly templateStore?: TemplateStore;
  readonly templatesError?: string;
  readonly attachmentStore?: AttachmentStore;
  readonly onPrompt: (prompt: string, context: PromptContext) => Promise<PromptAdapterResult>;
}

export interface RunningLocalBridgeServer {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly createSession: () => {
    id: string;
    token: string;
    expiresAt: Date;
  };
  readonly close: () => Promise<void>;
}

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

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
  const store = new SessionStore(options);
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
  let activeConnections = 0;

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

  webSocketServer.on('connection', (webSocket) => {
    if (activeConnections >= maxConnections) {
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
    attachConnection(
      webSocket,
      store,
      options.onPrompt,
      promptTimeoutMs,
      handshakeTimeoutMs,
      options.initialMarkdown,
      options.feedbackLoop ?? false,
      options.templateStore,
      options.templatesError,
      options.attachmentStore === undefined ? undefined : attachmentTokens,
      () => attachmentUrl,
    );
  });

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
      const session = store.create();
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

export function resolveStaticPath(staticDir: string, requestPath: string): string | undefined {
  const safeRoot = resolve(staticDir);
  const relativePath = requestPath === '/' ? 'index.html' : `.${requestPath}`;
  const candidate = resolve(safeRoot, relativePath);
  if (candidate !== safeRoot && !candidate.startsWith(`${safeRoot}${sep}`)) return undefined;
  return candidate;
}

function attachConnection(
  webSocket: WebSocket,
  store: SessionStore,
  onPrompt: LocalBridgeServerOptions['onPrompt'],
  promptTimeoutMs: number,
  handshakeTimeoutMs: number,
  initialMarkdown: string | undefined,
  feedbackLoop: boolean,
  templateStore: TemplateStore | undefined,
  templatesError: string | undefined,
  attachmentTokens: Map<string, string> | undefined,
  getAttachmentUrl: () => string,
): void {
  let sessionId: string | undefined;
  const submissions = new Set<string>();
  let handshakeComplete = false;
  let sessionExpiryTimeout: NodeJS.Timeout | undefined;
  let submissionQueue = Promise.resolve();
  const handshakeTimeout = setTimeout(() => {
    if (!handshakeComplete) {
      sendError(webSocket, 'invalid_token', 'A session handshake is required.');
      webSocket.close(1008);
    }
  }, handshakeTimeoutMs);

  webSocket.on('message', (raw: RawData) => {
    /* c8 ignore next 3 -- handleMessage catches all expected protocol and adapter failures. */
    void handleMessage(rawDataToString(raw)).catch(() => {
      sendError(webSocket, 'adapter_error', 'The bridge could not process this message.');
    });
  });
  webSocket.on('close', () => {
    clearTimeout(handshakeTimeout);
    if (sessionExpiryTimeout !== undefined) clearTimeout(sessionExpiryTimeout);
  });

  async function handleMessage(raw: string): Promise<void> {
    let input: unknown;
    try {
      input = JSON.parse(raw) as unknown;
    } catch {
      sendError(webSocket, 'invalid_message', 'Message must be valid JSON.');
      return;
    }

    const parsed = ClientMessageSchema.safeParse(input);
    if (!parsed.success) {
      sendError(webSocket, 'invalid_message', 'Message does not match the protocol.');
      return;
    }

    if (!handshakeComplete) {
      if (parsed.data.type !== 'session.handshake') {
        sendError(webSocket, 'invalid_token', 'The first message must be a session handshake.');
        webSocket.close(1008);
        return;
      }
      const session = store.authenticate(parsed.data.token);
      if (session === undefined) {
        sendError(
          webSocket,
          'invalid_token',
          'This session token is invalid, expired, or already used.',
        );
        webSocket.close(1008);
        return;
      }
      handshakeComplete = true;
      sessionId = session.id;
      clearTimeout(handshakeTimeout);
      sessionExpiryTimeout = setTimeout(
        () => {
          sendError(webSocket, 'session_expired', 'This bridge session has expired.');
          webSocket.close(1008);
        },
        Math.max(0, session.expiresAt.getTime() - Date.now()),
      );
      let templates: readonly PromptTemplate[] | undefined;
      let resolvedTemplatesError = templatesError;
      if (templateStore !== undefined) {
        try {
          templates = await templateStore.list();
        } catch (error) {
          resolvedTemplatesError = templateStoreErrorMessage(
            error,
            'Project templates could not be loaded from this directory.',
          );
        }
      }
      send(webSocket, {
        type: 'session.ready',
        sessionId: session.id,
        expiresAt: session.expiresAt.toISOString(),
        ...(initialMarkdown === undefined ? {} : { initialMarkdown }),
        ...(feedbackLoop ? { feedbackLoop } : {}),
        ...(templates === undefined ? {} : { templates: [...templates] }),
        ...(resolvedTemplatesError === undefined ? {} : { templatesError: resolvedTemplatesError }),
        ...(attachmentTokens === undefined
          ? {}
          : {
              attachmentUrl: getAttachmentUrl(),
              attachmentToken: attachmentTokens.get(session.id),
            }),
      });
      return;
    }

    /* c8 ignore next 4 -- sessionId is assigned by the successful handshake above. */
    if (sessionId === undefined) {
      sendError(webSocket, 'invalid_message', 'The bridge session is not ready.');
      return;
    }
    if (
      parsed.data.type === 'template.list' ||
      parsed.data.type === 'template.save' ||
      parsed.data.type === 'template.delete'
    ) {
      await handleTemplateRequest(parsed.data);
      return;
    }
    if (parsed.data.type !== 'prompt.submit') {
      sendError(
        webSocket,
        'invalid_message',
        'Only prompt submissions are accepted after handshake.',
      );
      return;
    }
    const promptSubmission = parsed.data;
    const queuedSubmission = submissionQueue.then(() => handleSubmission(promptSubmission));
    submissionQueue = queuedSubmission.catch(() => undefined);
    await queuedSubmission;
  }

  async function handleTemplateRequest(request: TemplateRequest): Promise<void> {
    if (templateStore === undefined) {
      send(webSocket, {
        type: 'template.result',
        requestId: request.requestId,
        status: 'failed',
        error: templatesError ?? 'Project templates are unavailable.',
      });
      return;
    }
    try {
      let templates: readonly PromptTemplate[];
      if (request.type === 'template.list') templates = await templateStore.list();
      else if (request.type === 'template.save')
        templates = await templateStore.save(request.template);
      else templates = await templateStore.delete(request.id);
      send(webSocket, {
        type: 'template.result',
        requestId: request.requestId,
        status: 'accepted',
        templates: [...templates],
      });
    } catch (error) {
      send(webSocket, {
        type: 'template.result',
        requestId: request.requestId,
        status: 'failed',
        error: templateStoreErrorMessage(error, 'Project templates could not be updated.'),
      });
    }
  }

  async function handleSubmission(submission: PromptSubmit): Promise<void> {
    if (submissions.has(submission.submissionId)) {
      sendError(webSocket, 'duplicate_submission', 'This submission has already been received.');
      return;
    }
    submissions.add(submission.submissionId);
    try {
      const latestMarkdown = await withTimeout(
        onPrompt(submission.prompt, {
          sessionId: sessionId as string,
          submissionId: submission.submissionId,
          mode: submission.mode ?? 'edit',
        }),
        promptTimeoutMs,
      );
      const result: ServerMessage = {
        type: 'prompt.result',
        submissionId: submission.submissionId,
        status: 'accepted',
        ...(latestMarkdown === undefined ? {} : { prompt: latestMarkdown }),
      };
      send(webSocket, result);
    } catch {
      send(webSocket, {
        type: 'prompt.result',
        submissionId: submission.submissionId,
        status: 'failed',
        error: 'The Codex session could not accept this prompt.',
      });
    }
  }
}

function rawDataToString(raw: RawData): string {
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString();
  if (Array.isArray(raw)) return Buffer.concat(raw).toString();
  return Buffer.from(raw).toString();
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
  const match = suffix.match(/^(?:\/([0-9a-f-]{36})(?:\.(png|json))?)?\/?$/i);
  if (match === null) {
    response.writeHead(404).end();
    return true;
  }
  if (request.method === 'POST' && match[1] === undefined) {
    void readRequestBody(request, 36 * 1024 * 1024)
      .then((body) => {
        let input: { id?: unknown; png?: unknown; scene?: unknown };
        try {
          input = JSON.parse(body) as typeof input;
        } catch (error) {
          throw new Error(
            `Attachment request JSON is invalid: ${
              error instanceof Error ? error.message : 'unknown parse error'
            }`,
          );
        }
        if (
          typeof input.png !== 'string' ||
          typeof input.scene !== 'string' ||
          (input.id !== undefined && typeof input.id !== 'string')
        )
          throw new Error('Invalid attachment request.');
        return attachmentStore.save({
          ...(typeof input.id === 'string' ? { id: input.id } : {}),
          png: input.png,
          scene: input.scene,
        });
      })
      .then((id) =>
        response.writeHead(201, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id })),
      )
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Attachment could not be saved.';
        const status = /25 MB/.test(message) ? 413 : 400;
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
      .then((deleted) => response.writeHead(deleted ? 204 : 404).end());
    return true;
  }
  void attachmentStore
    .read(id)
    .then((attachment) => {
      if (attachment === undefined) {
        response.writeHead(404).end();
        return;
      }
      if (kind === 'png') {
        response
          .writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' })
          .end(attachment.png);
        return;
      }
      if (kind === 'json') {
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
    if (size > maxBytes) throw new Error('The attachment request is too large.');
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('The prompt adapter timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function send(webSocket: WebSocket, message: ServerMessage): void {
  if (webSocket.readyState === webSocket.OPEN) webSocket.send(encodeServerMessage(message));
}

function templateStoreErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && 'code' in error && error.code === 'ERR_TEMPLATE_SYMLINK') {
    return 'Project template storage does not allow symbolic links. Replace them with regular files and directories.';
  }
  return fallback;
}

function sendError(
  webSocket: WebSocket,
  code: Extract<ServerMessage, { type: 'session.error' }>['code'],
  message: string,
): void {
  send(webSocket, { type: 'session.error', code, message });
}

async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  staticDir: string | undefined,
): Promise<void> {
  if (staticDir === undefined) {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Codex Complex Prompt bridge is running.');
    return;
  }
  const requestPath = new URL(request.url ?? '/', 'http://localhost').pathname;
  const candidate = resolveStaticPath(staticDir, requestPath);
  /* c8 ignore start -- the HTTP URL parser normalizes dot segments; the helper is tested directly. */
  if (candidate === undefined) {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }
  /* c8 ignore stop */
  try {
    const file = await stat(candidate);
    if (!file.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'content-type': mimeTypes[extname(candidate)] ?? 'application/octet-stream',
    });
    createReadStream(candidate).pipe(response);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
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
