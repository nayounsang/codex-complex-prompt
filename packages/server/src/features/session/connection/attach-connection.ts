import {
  ClientMessageSchema,
  encodeServerMessage,
  type PromptTemplate,
  type ServerMessage,
} from '@codex-complex-prompt/protocol';
import { type RawData, type WebSocket } from 'ws';

import { createPromptMessageHandler } from '../../input/handlers/create-prompt-message-handler.js';
import {
  handleTemplateRequest,
  templateStoreErrorMessage,
} from '../../templates/handlers/handle-template-request.js';
import type { LocalBridgeServerOptions, TemplateStore } from '../../../shared/types.js';
import type { SessionRecord, SessionStore } from '../storage/session-store.js';

export interface BridgeConnectionOptions {
  readonly webSocket: WebSocket;
  readonly sessionStore: SessionStore;
  readonly onPrompt: LocalBridgeServerOptions['onPrompt'];
  readonly promptTimeoutMs: number;
  readonly handshakeTimeoutMs: number;
  readonly initialMarkdown: string | undefined;
  readonly feedbackLoop: boolean;
  readonly templateStore: TemplateStore | undefined;
  readonly templatesError: string | undefined;
}

export function attachConnection(options: BridgeConnectionOptions): void {
  const {
    webSocket,
    sessionStore,
    onPrompt,
    promptTimeoutMs,
    handshakeTimeoutMs,
    initialMarkdown,
    feedbackLoop,
    templateStore,
    templatesError,
  } = options;
  let sessionId: string | undefined;
  let handlePromptMessage: ReturnType<typeof createPromptMessageHandler> | undefined;
  let handshakeComplete = false;
  let sessionExpiryTimeout: NodeJS.Timeout | undefined;
  const handshakeTimeout = setTimeout(() => {
    if (!handshakeComplete) {
      sendError(webSocket, 'invalid_token', 'A session handshake is required.');
      webSocket.close(1008);
    }
  }, handshakeTimeoutMs);

  webSocket.on('message', (raw: RawData) => {
    /* c8 ignore next 3 -- handleMessage catches expected protocol and adapter failures. */
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
      const session = sessionStore.authenticate(parsed.data.token);
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
      handlePromptMessage = createPromptMessageHandler(
        webSocket,
        session.id,
        onPrompt,
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
        templateStore,
        templatesError,
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
      await handleTemplateRequest(webSocket, parsed.data, templateStore, templatesError);
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
    await handlePromptMessage(parsed.data);
  }

  async function createReadyMessage(input: {
    readonly session: SessionRecord;
    readonly initialMarkdown: string | undefined;
    readonly feedbackLoop: boolean;
    readonly templateStore: TemplateStore | undefined;
    readonly templatesError: string | undefined;
  }): Promise<ServerMessage> {
    const { session } = input;
    let templates: readonly PromptTemplate[] | undefined;
    let resolvedTemplatesError = input.templatesError;
    if (input.templateStore !== undefined) {
      try {
        templates = await input.templateStore.list();
      } catch (error) {
        resolvedTemplatesError = templateStoreErrorMessage(
          error,
          'Project templates could not be loaded from this directory.',
        );
      }
    }
    return {
      type: 'session.ready',
      sessionId: session.id,
      expiresAt: session.expiresAt.toISOString(),
      ...(input.initialMarkdown === undefined ? {} : { initialMarkdown: input.initialMarkdown }),
      ...(input.feedbackLoop ? { feedbackLoop: input.feedbackLoop } : {}),
      ...(templates === undefined ? {} : { templates: [...templates] }),
      ...(resolvedTemplatesError === undefined ? {} : { templatesError: resolvedTemplatesError }),
    };
  }
}

function rawDataToString(raw: RawData): string {
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString();
  if (Array.isArray(raw)) return Buffer.concat(raw).toString();
  return Buffer.from(raw).toString();
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
