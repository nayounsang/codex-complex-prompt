import { createReadStream } from 'node:fs';
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
  type ServerMessage,
} from '@codex-complex-prompt/protocol';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import { SessionStore, type SessionStoreOptions } from './session-store.js';

export { SessionStore } from './session-store.js';
export type { SessionRecord, SessionStoreOptions } from './session-store.js';

export interface PromptContext {
  readonly sessionId: string;
  readonly submissionId: string;
}

export interface LocalBridgeServerOptions extends SessionStoreOptions {
  readonly host?: string;
  readonly port?: number;
  readonly staticDir?: string;
  readonly promptTimeoutMs?: number;
  readonly maxConnections?: number;
  readonly handshakeTimeoutMs?: number;
  readonly onPrompt: (prompt: string, context: PromptContext) => Promise<void>;
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
  const httpServer = createServer((request, response) => {
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
    attachConnection(webSocket, store, options.onPrompt, promptTimeoutMs, handshakeTimeoutMs);
  });

  await listen(httpServer, host, port);
  const address = httpServer.address();
  /* c8 ignore next 4 -- listen() on a TCP server always returns an AddressInfo here. */
  if (address === null || typeof address === 'string') {
    throw new Error('The local bridge server did not expose a TCP address.');
  }

  return {
    host,
    port: address.port,
    url: `http://${host}:${address.port}`,
    createSession: () => {
      const session = store.create();
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
      send(webSocket, {
        type: 'session.ready',
        sessionId: session.id,
        expiresAt: session.expiresAt.toISOString(),
      });
      return;
    }

    /* c8 ignore next 4 -- sessionId is assigned by the successful handshake above. */
    if (sessionId === undefined) {
      sendError(webSocket, 'invalid_message', 'The bridge session is not ready.');
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

  async function handleSubmission(submission: PromptSubmit): Promise<void> {
    if (submissions.has(submission.submissionId)) {
      sendError(webSocket, 'duplicate_submission', 'This submission has already been received.');
      return;
    }
    submissions.add(submission.submissionId);
    try {
      await withTimeout(
        onPrompt(submission.prompt, {
          sessionId: sessionId as string,
          submissionId: submission.submissionId,
        }),
        promptTimeoutMs,
      );
      send(webSocket, {
        type: 'prompt.result',
        submissionId: submission.submissionId,
        status: 'accepted',
      });
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
