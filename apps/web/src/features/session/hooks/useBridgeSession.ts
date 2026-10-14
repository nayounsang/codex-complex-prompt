import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  FeedbackSubagentSettings,
  PromptSubmitMode,
  ServerMessage,
} from '@codex-complex-prompt/protocol';

import { connectBridgeTransport } from '../infrastructure/bridge-transport.js';
import { getInitialConnection, parseBridgeUrl } from './bridge-url.js';
import type {
  BridgeSession,
  ConnectionState,
  PromptResult,
  TemplateChangeRequest,
  TemplateResult,
} from './bridge-session-types.js';
import { useAttachment } from './useAttatchment.js';
import { useDelayedClose } from './useDelayedClose.js';
import { usePending } from './usePending.js';
export type {
  BridgeSession,
  ConnectionState,
  PromptResult,
  TemplateChangeRequest,
  TemplateResult,
} from './bridge-session-types.js';

export function useBridgeSession(): BridgeSession {
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    () => getInitialConnection().state,
  );
  const [error, setError] = useState<string | null>(() => getInitialConnection().error);
  const [bridgeUrl, setBridgeUrl] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('bridge') ?? window.location.origin;
  });
  const tokenRef = useRef<string | null>(null);
  const bridgeRef = useRef<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const [initialMarkdown, setInitialMarkdown] = useState<string | null>(null);
  const [feedbackLoop, setFeedbackLoop] = useState(false);
  const [feedbackModelCatalog, setFeedbackModelCatalog] = useState<
    BridgeSession['feedbackModelCatalog']
  >([]);
  const [feedbackModelCatalogLoading, setFeedbackModelCatalogLoading] = useState(false);
  const [templateSnapshot, setTemplateSnapshot] = useState<BridgeSession['templateSnapshot']>(null);

  const { attachmentUrl, attachmentToken, setAttachment } = useAttachment();
  const { isCloseScheduled, cancelClose, clearCloseTimer, scheduleClose } = useDelayedClose();
  const pendingPrompts = usePending<PromptResult>();
  const pendingTemplates = usePending<TemplateResult>();
  const failPendingResults = useCallback(
    (message: string): void => {
      const failure = { status: 'failed' as const, error: message };
      pendingPrompts.failAll(failure);
      pendingTemplates.failAll(failure);
    },
    [pendingPrompts, pendingTemplates],
  );

  useEffect(
    function connectToBridge() {
      const searchParams = new URLSearchParams(window.location.search);
      const token = tokenRef.current ?? searchParams.get('token');
      if (token === null) {
        return;
      }
      tokenRef.current = token;
      const bridge = bridgeRef.current ?? searchParams.get('bridge') ?? window.location.origin;
      const bridgeResult = parseBridgeUrl(bridge);
      if (bridgeResult.url === null) return;
      const bridgeOrigin = bridgeResult.url;
      bridgeRef.current = bridge;
      setBridgeUrl(bridge);
      const cleanUrl = `${window.location.pathname}${window.location.hash}`;
      if (searchParams.has('token')) {
        window.history.replaceState({}, document.title, cleanUrl);
      }
      function handleMessage(connection: WebSocket, message: ServerMessage): void {
        if (socketRef.current !== connection) return;
        if (message.type === 'session.ready') {
          setConnectionState('connected');
          setError(null);
          setInitialMarkdown(message.initialMarkdown ?? '');
          setFeedbackLoop(message.feedbackLoop ?? false);
          setFeedbackModelCatalog(message.feedbackModelCatalog ?? []);
          const shouldLoadFeedbackModelCatalog = message.feedbackModelCatalog === undefined;
          setFeedbackModelCatalogLoading(shouldLoadFeedbackModelCatalog);
          if (shouldLoadFeedbackModelCatalog) {
            try {
              connection.send(JSON.stringify({ type: 'feedback-model.catalog.request' }));
            } catch {
              setFeedbackModelCatalogLoading(false);
            }
          }
          setAttachment(message.attachmentUrl ?? null, message.attachmentToken ?? null);
          setTemplateSnapshot({
            templates: message.templates ?? [],
            error: message.templatesError ?? null,
          });
        } else if (message.type === 'feedback-model.catalog.result') {
          setFeedbackModelCatalog(message.catalog);
          setFeedbackModelCatalogLoading(false);
        } else if (message.type === 'template.result') {
          const result: TemplateResult = {
            status: message.status,
            ...(message.templates === undefined ? {} : { templates: message.templates }),
            ...(message.error === undefined ? {} : { error: message.error }),
          };
          pendingTemplates.resolve(message.requestId, result);
        } else if (message.type === 'prompt.result') {
          const result: PromptResult = {
            status: message.status,
            ...(message.error === undefined ? {} : { error: message.error }),
            ...(message.prompt === undefined ? {} : { prompt: message.prompt }),
          };
          pendingPrompts.resolve(message.submissionId, result);
          if (message.status === 'accepted') {
            setConnectionState('success');
            setError(null);
            scheduleClose();
          } else {
            cancelClose();
            setConnectionState('error');
            setError(message.error ?? 'The command could not be sent.');
          }
        } else if (message.type === 'session.error') {
          failPendingResults(message.message);
          setConnectionState('error');
          setError(message.message);
        }
      }

      function handleInvalidMessage(connection: WebSocket): void {
        if (socketRef.current !== connection) return;
        failPendingResults('The bridge returned an invalid message.');
        setConnectionState('error');
        setError('The bridge returned an invalid message.');
      }

      function handleClose(connection: WebSocket): void {
        if (socketRef.current !== connection) return;
        socketRef.current = null;
        failPendingResults('The bridge connection closed.');
        setConnectionState((current) =>
          current === 'success' || current === 'error' ? current : 'disconnected',
        );
      }

      function handleError(connection: WebSocket): void {
        if (socketRef.current !== connection) return;
        failPendingResults('Could not connect to the local bridge.');
        setConnectionState('error');
        setError('Could not connect to the local bridge.');
      }

      const transport = connectBridgeTransport(bridgeOrigin, token, {
        onMessage: handleMessage,
        onInvalidMessage: handleInvalidMessage,
        onClose: handleClose,
        onError: handleError,
      });
      const connection = transport.socket;
      socketRef.current = connection;

      return function cleanupBridgeConnection() {
        failPendingResults('The bridge connection closed.');
        clearCloseTimer();
        if (socketRef.current === connection) {
          socketRef.current = null;
        }
        transport.close();
      };
    },
    [
      cancelClose,
      clearCloseTimer,
      failPendingResults,
      pendingPrompts,
      pendingTemplates,
      scheduleClose,
    ],
  );

  const submit = useCallback(
    (
      prompt: string,
      mode: PromptSubmitMode = 'edit',
      options: FeedbackSubagentSettings = {},
    ): Promise<PromptResult> => {
      const socket = socketRef.current;
      /* c8 ignore next -- the button disables this path when no authenticated socket exists. */
      if (
        socket === null ||
        socket.readyState !== WebSocket.OPEN ||
        (prompt.trim() === '' && mode !== 'finish')
      ) {
        return Promise.resolve({ status: 'failed', error: 'The bridge is not connected.' });
      }
      setConnectionState('submitting');
      setError(null);
      const submissionId = crypto.randomUUID();
      const result = pendingPrompts.waitFor(submissionId);
      try {
        socket.send(
          JSON.stringify({
            type: 'prompt.submit',
            submissionId,
            prompt: prompt.trim(),
            ...(mode === 'edit' ? {} : { mode }),
            ...(mode === 'feedback' && options.sendFeedbackToSubagent === true
              ? { sendFeedbackToSubagent: true }
              : {}),
            ...(mode === 'feedback' &&
            options.sendFeedbackToSubagent === true &&
            options.feedbackModel !== undefined
              ? { feedbackModel: options.feedbackModel }
              : {}),
          }),
        );
      } catch {
        pendingPrompts.delete(submissionId);
        setConnectionState('error');
        setError('The bridge connection closed.');
        return Promise.resolve({ status: 'failed', error: 'The bridge connection closed.' });
      }
      return result;
    },
    [pendingPrompts],
  );

  const requestTemplateChange = useCallback(
    (request: TemplateChangeRequest): Promise<TemplateResult> => {
      const socket = socketRef.current;
      if (socket === null || socket.readyState !== WebSocket.OPEN) {
        return Promise.resolve({ status: 'failed', error: 'The bridge is not connected.' });
      }
      const requestId = crypto.randomUUID();
      const result = pendingTemplates.waitFor(requestId);
      try {
        socket.send(JSON.stringify({ ...request, requestId }));
      } catch {
        pendingTemplates.delete(requestId);
        return Promise.resolve({ status: 'failed', error: 'The bridge connection closed.' });
      }
      return result;
    },
    [pendingTemplates],
  );

  return {
    connectionState,
    error,
    isCloseScheduled,
    bridgeUrl,
    initialMarkdown,
    feedbackLoop,
    feedbackModelCatalog,
    feedbackModelCatalogLoading,
    attachmentUrl,
    attachmentToken,
    templateSnapshot,
    requestTemplateChange,
    submit,
  };
}
