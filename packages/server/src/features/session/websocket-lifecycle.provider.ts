import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer } from 'ws';
import type { Server as HttpServer } from 'node:http';

import { AttachmentTokenStore } from '../attachments/attachment-token-store.js';
import { attachConnection } from './connection/attach-connection.js';
import { SessionStore } from './storage/session-store.js';
import { BRIDGE_OPTIONS } from '../../runtime/tokens.js';
import type { LocalBridgeServerOptions } from '../../shared/types.js';

@Injectable()
export class WebSocketLifecycleProvider implements OnModuleInit, OnModuleDestroy {
  private webSocketServer: WebSocketServer | undefined;

  public constructor(
    @Inject(HttpAdapterHost) private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(BRIDGE_OPTIONS) private readonly options: LocalBridgeServerOptions,
    @Inject(SessionStore) private readonly sessionStore: SessionStore,
    @Inject(AttachmentTokenStore) private readonly attachmentTokens: AttachmentTokenStore,
  ) {}

  public onModuleInit(): void {
    validatePositiveInteger(this.options.maxConnections ?? 8, 'Maximum connections');
    validatePositiveInteger(this.options.promptTimeoutMs ?? 30_000, 'Prompt timeout');
    validatePositiveInteger(this.options.handshakeTimeoutMs ?? 5_000, 'Handshake timeout');

    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer() as HttpServer;
    const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    const host = this.options.host ?? '127.0.0.1';
    this.webSocketServer = webSocketServer;

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

    this.registerConnections(webSocketServer, host, httpServer);
  }

  public async onModuleDestroy(): Promise<void> {
    const webSocketServer = this.webSocketServer;
    if (webSocketServer === undefined) return;

    for (const webSocket of webSocketServer.clients) webSocket.terminate();
    await new Promise<void>((resolve, reject) => {
      webSocketServer.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }

  private registerConnections(
    webSocketServer: WebSocketServer,
    host: string,
    httpServer: HttpServer,
  ): void {
    const maxConnections = this.options.maxConnections ?? 8;
    const promptTimeoutMs = this.options.promptTimeoutMs ?? 30_000;
    const handshakeTimeoutMs = this.options.handshakeTimeoutMs ?? 5_000;
    let activeConnections = 0;

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
      attachConnection({
        webSocket,
        sessionStore: this.sessionStore,
        onPrompt: this.options.onPrompt,
        promptTimeoutMs,
        handshakeTimeoutMs,
        initialMarkdown: this.options.initialMarkdown,
        feedbackLoop: this.options.feedbackLoop ?? false,
        feedbackModelCatalog: this.options.feedbackModelCatalog,
        loadFeedbackModelCatalog: this.options.loadFeedbackModelCatalog,
        templateStore: this.options.templateStore,
        templatesError: this.options.templatesError,
        attachmentTokens:
          this.options.attachmentStore === undefined ? undefined : this.attachmentTokens,
        getAttachmentUrl: () => {
          const address = httpServer.address();
          if (address === null || typeof address === 'string') return '';
          return `http://${host}:${address.port}/_complex-prompt/attachments`;
        },
      });
    });
  }
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}
