import {
  encodeServerMessage,
  isFeedbackModelSupported,
  type FeedbackModelCatalogEntry,
  type ServerMessage,
} from '@codex-complex-prompt/protocol';
import { omitBy } from 'es-toolkit';
import { type WebSocket } from 'ws';

import type { InputService } from '../../input/input.service.js';
import type { LocalBridgeServerOptions } from '../../../shared/types.js';
import type { TemplateService } from '../../templates/template.service.js';
import type { SessionEntity } from '../entities/session.entity.js';
import type { SessionService } from '../session.service.js';
import { ClientMessageDtoSchema } from '../dto/client-message.dto.js';

type SessionReadyMessage = Extract<ServerMessage, { type: 'session.ready' }>;
type SessionReadyOptionalFields = Partial<
  Omit<SessionReadyMessage, 'type' | 'sessionId' | 'expiresAt'>
>;

export interface BridgeConnectionOptions {
  readonly webSocket: WebSocket;
  readonly sessionService: Pick<SessionService, 'authenticate'>;
  readonly inputService: InputService;
  readonly templateService: TemplateService;
  readonly promptTimeoutMs: number;
  readonly handshakeTimeoutMs: number;
  readonly initialMarkdown: string | undefined;
  readonly feedbackLoop: boolean;
  readonly feedbackModelCatalog: LocalBridgeServerOptions['feedbackModelCatalog'];
  readonly loadFeedbackModelCatalog: LocalBridgeServerOptions['loadFeedbackModelCatalog'];
  readonly attachmentTokens: Pick<ReadonlyMap<string, string>, 'get'> | undefined;
  readonly getAttachmentUrl: () => string;
}

export function createConnectionMessageHandler(
  options: BridgeConnectionOptions,
): (raw: string) => void {
  const {
    webSocket,
    sessionService,
    inputService,
    templateService,
    promptTimeoutMs,
    handshakeTimeoutMs,
    initialMarkdown,
    feedbackLoop,
    feedbackModelCatalog,
    loadFeedbackModelCatalog,
    attachmentTokens,
    getAttachmentUrl,
  } = options;
  let sessionId: string | undefined;
  let handlePromptMessage: ReturnType<InputService['createPromptMessageHandler']> | undefined;
  let resolvedFeedbackModelCatalog = feedbackModelCatalog;
  let feedbackModelCatalogPromise: Promise<readonly FeedbackModelCatalogEntry[]> | undefined;
  let handshakeComplete = false;
  let sessionExpiryTimeout: NodeJS.Timeout | undefined;
  const handshakeTimeout = setTimeout(() => {
    if (!handshakeComplete) {
      sendError(webSocket, 'invalid_token', 'A session handshake is required.');
      webSocket.close(1008);
    }
  }, handshakeTimeoutMs);

  webSocket.on('close', () => {
    clearTimeout(handshakeTimeout);
    if (sessionExpiryTimeout !== undefined) clearTimeout(sessionExpiryTimeout);
  });

  return (raw: string): void => {
    /* c8 ignore next 3 -- handleMessage catches expected protocol and adapter failures. */
    void handleMessage(raw).catch(() => {
      sendError(webSocket, 'adapter_error', 'The bridge could not process this message.');
    });
  };

  async function handleMessage(raw: string): Promise<void> {
    let input: unknown;
    try {
      input = JSON.parse(raw) as unknown;
    } catch {
      sendError(webSocket, 'invalid_message', 'Message must be valid JSON.');
      return;
    }

    const parsed = ClientMessageDtoSchema.safeParse(input);
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
      const session = sessionService.authenticate(parsed.data.token);
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
      handlePromptMessage = inputService.createPromptMessageHandler(
        webSocket,
        session.id,
        promptTimeoutMs,
      );
      clearTimeout(handshakeTimeout);
      sessionExpiryTimeout = setTimeout(
        () => {
          sendError(webSocket, 'session_expired', 'This bridge session has expired.');
          webSocket.close(1008);
        },
        Math.max(0, session.expiresAt.getTime() - Date.now()),
      );
      const readyMessage = await createReadyMessage({
        session,
        initialMarkdown,
        feedbackLoop,
        feedbackModelCatalog,
        templateService,
        attachmentTokens,
        getAttachmentUrl,
      });
      send(webSocket, readyMessage);
      return;
    }

    /* c8 ignore next 4 -- a completed handshake creates the prompt handler with a session ID. */
    if (sessionId === undefined) {
      sendError(webSocket, 'invalid_message', 'The bridge session is not ready.');
      return;
    }
    if (
      parsed.data.type === 'template.list' ||
      parsed.data.type === 'template.save' ||
      parsed.data.type === 'template.delete'
    ) {
      await templateService.handleRequest(webSocket, parsed.data);
      return;
    }
    if (parsed.data.type === 'feedback-model.catalog.request') {
      feedbackModelCatalogPromise ??= (async () => {
        try {
          return resolvedFeedbackModelCatalog ?? (await loadFeedbackModelCatalog?.()) ?? [];
        } catch {
          return [];
        }
      })();
      resolvedFeedbackModelCatalog = await feedbackModelCatalogPromise;
      send(webSocket, {
        type: 'feedback-model.catalog.result',
        catalog: [...resolvedFeedbackModelCatalog],
      });
      return;
    }
    if (parsed.data.type !== 'prompt.submit' || handlePromptMessage === undefined) {
      sendError(
        webSocket,
        'invalid_message',
        'Only prompt submissions are accepted after handshake.',
      );
      return;
    }
    if (
      parsed.data.sendFeedbackToSubagent !== false &&
      parsed.data.feedbackModel !== undefined &&
      !isFeedbackModelSupported(parsed.data.feedbackModel, resolvedFeedbackModelCatalog ?? [])
    ) {
      sendError(webSocket, 'invalid_message', 'The selected feedback model is not supported.');
      return;
    }
    await handlePromptMessage(parsed.data);
  }

  async function createReadyMessage(input: {
    readonly session: SessionEntity;
    readonly initialMarkdown: string | undefined;
    readonly feedbackLoop: boolean;
    readonly feedbackModelCatalog: LocalBridgeServerOptions['feedbackModelCatalog'];
    readonly templateService: TemplateService;
    readonly attachmentTokens: Pick<ReadonlyMap<string, string>, 'get'> | undefined;
    readonly getAttachmentUrl: () => string;
  }): Promise<ServerMessage> {
    const { session } = input;
    const templateState = await input.templateService.getInitialState();
    const optionalFields = omitBy(
      {
        initialMarkdown: input.initialMarkdown,
        feedbackLoop: input.feedbackLoop ? input.feedbackLoop : undefined,
        feedbackModelCatalog:
          input.feedbackModelCatalog === undefined ? undefined : [...input.feedbackModelCatalog],
        templates: templateState.templates === undefined ? undefined : [...templateState.templates],
        templatesError: templateState.templatesError,
        attachmentUrl: input.attachmentTokens === undefined ? undefined : input.getAttachmentUrl(),
        attachmentToken: input.attachmentTokens?.get(session.id),
      },
      (value) => value === undefined,
    ) as SessionReadyOptionalFields;
    return {
      type: 'session.ready',
      sessionId: session.id,
      expiresAt: session.expiresAt.toISOString(),
      ...optionalFields,
    };
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
