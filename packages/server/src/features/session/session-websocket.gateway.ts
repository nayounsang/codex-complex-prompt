import { Inject } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Server as HttpServer } from 'node:http';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { WebSocket } from 'ws';

import { AttachmentTokenStore } from '../attachments/store/attachment-token.store.js';
import { InputService } from '../input/input.service.js';
import { TemplateService } from '../templates/template.service.js';
import { createConnectionMessageHandler } from './connection/attach-connection.js';
import { SessionService } from './session.service.js';
import { BRIDGE_OPTIONS } from '../../runtime/tokens.js';
import type { LocalBridgeServerOptions } from '../../shared/types.js';

const INTERNAL_MESSAGE_EVENT = 'bridge.message';

@WebSocketGateway({ path: '/ws', maxPayload: 64 * 1024 })
export class SessionWebSocketGateway
  implements OnGatewayConnection<WebSocket>, OnGatewayDisconnect<WebSocket>
{
  private readonly activeConnections = new Set<WebSocket>();
  private readonly connectionMessageHandlers = new WeakMap<WebSocket, (raw: string) => void>();

  public constructor(
    @Inject(HttpAdapterHost) private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(BRIDGE_OPTIONS) private readonly options: LocalBridgeServerOptions,
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(AttachmentTokenStore) private readonly attachmentTokens: AttachmentTokenStore,
    @Inject(InputService) private readonly inputService: InputService,
    @Inject(TemplateService) private readonly templateService: TemplateService,
  ) {}

  public handleConnection(webSocket: WebSocket): void {
    const maxConnections = this.options.maxConnections ?? 8;
    if (this.activeConnections.size >= maxConnections) {
      webSocket.close(1013, 'The bridge has reached its connection limit.');
      return;
    }

    this.activeConnections.add(webSocket);
    webSocket.once('error', () => this.releaseConnection(webSocket));
    this.connectionMessageHandlers.set(
      webSocket,
      createConnectionMessageHandler({
        webSocket,
        sessionService: this.sessionService,
        inputService: this.inputService,
        templateService: this.templateService,
        promptTimeoutMs: this.options.promptTimeoutMs ?? 30_000,
        handshakeTimeoutMs: this.options.handshakeTimeoutMs ?? 5_000,
        initialMarkdown: this.options.initialMarkdown,
        feedbackLoop: this.options.feedbackLoop ?? false,
        feedbackModelCatalog: this.options.feedbackModelCatalog,
        loadFeedbackModelCatalog: this.options.loadFeedbackModelCatalog,
        attachmentTokens:
          this.options.attachmentStore === undefined ? undefined : this.attachmentTokens,
        getAttachmentUrl: () => {
          const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer() as HttpServer;
          const address = httpServer.address();
          if (address === null || typeof address === 'string') return '';
          const host = this.options.host ?? '127.0.0.1';
          return `http://${host}:${address.port}/_complex-prompt/attachments`;
        },
      }),
    );
  }

  public handleDisconnect(webSocket: WebSocket): void {
    this.releaseConnection(webSocket);
  }

  @SubscribeMessage(INTERNAL_MESSAGE_EVENT)
  public handleMessage(@ConnectedSocket() webSocket: WebSocket, @MessageBody() raw: string): void {
    this.connectionMessageHandlers.get(webSocket)?.(raw);
  }

  private releaseConnection(webSocket: WebSocket): void {
    this.activeConnections.delete(webSocket);
    this.connectionMessageHandlers.delete(webSocket);
  }
}
