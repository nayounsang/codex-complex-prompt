import { createServer, type Server as HttpServer } from 'node:http';

import { WebSocketServer } from 'ws';

import { SessionStore } from './features/session/storage/session-store.js';
import { attachConnection } from './features/session/connection/attach-connection.js';
import { serveStatic, resolveStaticPath } from './infrastructure/http/static-files.js';
import type { LocalBridgeServerOptions, RunningLocalBridgeServer } from './shared/types.js';

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
  const httpServer = createServer((request, response) => {
    void serveStatic(request, response, options.staticDir);
  });
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  registerWebSocketUpgrade(httpServer, webSocketServer, host);
  registerConnections(webSocketServer, sessionStore, options, {
    maxConnections,
    promptTimeoutMs,
    handshakeTimeoutMs,
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
      const session = sessionStore.create();
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
    });
  });
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
