import { useCallback, useEffect, useRef, useState } from 'react';

import type { PromptSubmitMode, ServerMessage } from '@codex-complex-prompt/protocol';

import { connectBridgeTransport } from '../infrastructure/bridge-transport.js';
import { getInitialConnection, parseBridgeUrl } from './bridge-url.js';
import type {
  BridgeSession,
  ConnectionState,
  PromptResult,
  TemplateChangeRequest,
  TemplateResult,
} from './bridge-session-types.js';
export type {
  BridgeSession,
  ConnectionState,
  PromptResult,
  TemplateChangeRequest,
  TemplateResult,
} from './bridge-session-types.js';

const COMMAND_WINDOW_CLOSE_DELAY_MS = 3_000;

export function useBridgeSession(): BridgeSession {
  const [state, setState] = useState<ConnectionState>(() => getInitialConnection().state);
  const [error, setError] = useState<string | null>(() => getInitialConnection().error);
  const [closeInSeconds, setCloseInSeconds] = useState<number | null>(null);
  const [initialMarkdown, setInitialMarkdown] = useState<string | null>(null);
  const [feedbackLoop, setFeedbackLoop] = useState(false);
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [attachmentToken, setAttachmentToken] = useState<string | null>(null);
  const [templateSnapshot, setTemplateSnapshot] = useState<BridgeSession['templateSnapshot']>(null);
  const [bridgeUrl, setBridgeUrl] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('bridge') ?? window.location.origin;
  });
  const tokenRef = useRef<string | null>(null);
  const bridgeRef = useRef<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const countdownTimer = useRef<number | undefined>(undefined);
  const pendingResults = useRef(new Map<string, (result: PromptResult) => void>());
  const pendingTemplateResults = useRef(new Map<string, (result: TemplateResult) => void>());

  const clearCloseTimers = useCallback((): void => {
    if (closeTimer.current !== undefined) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
    if (countdownTimer.current !== undefined) {
      window.clearInterval(countdownTimer.current);
      countdownTimer.current = undefined;
    }
  }, []);

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
      function failPendingResults(message: string): void {
        const pending = pendingResults.current;
        pendingResults.current = new Map();
        for (const resolve of pending.values()) resolve({ status: 'failed', error: message });

        const pendingTemplates = pendingTemplateResults.current;
        pendingTemplateResults.current = new Map();
        for (const resolve of pendingTemplates.values())
          resolve({ status: 'failed', error: message });
      }

      function handleMessage(connection: WebSocket, message: ServerMessage): void {
        if (socketRef.current !== connection) return;
        if (message.type === 'session.ready') {
          setState('connected');
          setError(null);
          setInitialMarkdown(message.initialMarkdown ?? '');
          setFeedbackLoop(message.feedbackLoop ?? false);
          setAttachmentUrl(message.attachmentUrl ?? null);
          setAttachmentToken(message.attachmentToken ?? null);
          setTemplateSnapshot({
            templates: message.templates ?? [],
            error: message.templatesError ?? null,
          });
        } else if (message.type === 'template.result') {
          const result: TemplateResult = {
            status: message.status,
            ...(message.templates === undefined ? {} : { templates: message.templates }),
            ...(message.error === undefined ? {} : { error: message.error }),
          };
          pendingTemplateResults.current.get(message.requestId)?.(result);
          pendingTemplateResults.current.delete(message.requestId);
        } else if (message.type === 'prompt.result') {
          const result: PromptResult = {
            status: message.status,
            ...(message.error === undefined ? {} : { error: message.error }),
            ...(message.prompt === undefined ? {} : { prompt: message.prompt }),
          };
          pendingResults.current.get(message.submissionId)?.(result);
          pendingResults.current.delete(message.submissionId);
          if (message.status === 'accepted') {
            setState('success');
            setError(null);
            clearCloseTimers();
            setCloseInSeconds(COMMAND_WINDOW_CLOSE_DELAY_MS / 1_000);
            closeTimer.current = window.setTimeout(() => {
              closeTimer.current = undefined;
              window.close();
            }, COMMAND_WINDOW_CLOSE_DELAY_MS);
            countdownTimer.current = window.setInterval(() => {
              setCloseInSeconds((current) => {
                if (current === null || current <= 1) {
                  clearCloseTimers();
                  return 0;
                }
                return current - 1;
              });
            }, 1_000);
          } else {
            setState('error');
            setError(message.error ?? 'The command could not be sent.');
            clearCloseTimers();
            setCloseInSeconds(null);
          }
        } else if (message.type === 'session.error') {
          failPendingResults(message.message);
          setState('error');
          setError(message.message);
        }
      }

      function handleInvalidMessage(connection: WebSocket): void {
        if (socketRef.current !== connection) return;
        failPendingResults('The bridge returned an invalid message.');
        setState('error');
        setError('The bridge returned an invalid message.');
      }

      function handleClose(connection: WebSocket): void {
        if (socketRef.current !== connection) return;
        socketRef.current = null;
        failPendingResults('The bridge connection closed.');
        setState((current) =>
          current === 'success' || current === 'error' ? current : 'disconnected',
        );
      }

      function handleError(connection: WebSocket): void {
        if (socketRef.current !== connection) return;
        failPendingResults('Could not connect to the local bridge.');
        setState('error');
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
        clearCloseTimers();
        if (socketRef.current === connection) {
          socketRef.current = null;
        }
        transport.close();
      };
    },
    [clearCloseTimers],
  );

  const submit = useCallback(
    (prompt: string, mode: PromptSubmitMode = 'edit'): Promise<PromptResult> => {
      const socket = socketRef.current;
      /* c8 ignore next -- the button disables this path when no authenticated socket exists. */
      if (
        socket === null ||
        socket.readyState !== WebSocket.OPEN ||
        (prompt.trim() === '' && mode !== 'finish')
      ) {
        return Promise.resolve({ status: 'failed', error: 'The bridge is not connected.' });
      }
      setState('submitting');
      setError(null);
      const submissionId = crypto.randomUUID();
      const result = new Promise<PromptResult>((resolve) => {
        pendingResults.current.set(submissionId, resolve);
      });
      try {
        socket.send(
          JSON.stringify({
            type: 'prompt.submit',
            submissionId,
            prompt: prompt.trim(),
            ...(mode === 'edit' ? {} : { mode }),
          }),
        );
      } catch {
        pendingResults.current.delete(submissionId);
        setState('error');
        setError('The bridge connection closed.');
        return Promise.resolve({ status: 'failed', error: 'The bridge connection closed.' });
      }
      return result;
    },
    [],
  );

  const requestTemplateChange = useCallback(
    (request: TemplateChangeRequest): Promise<TemplateResult> => {
      const socket = socketRef.current;
      if (socket === null || socket.readyState !== WebSocket.OPEN) {
        return Promise.resolve({ status: 'failed', error: 'The bridge is not connected.' });
      }
      const requestId = crypto.randomUUID();
      const result = new Promise<TemplateResult>((resolve) =>
        pendingTemplateResults.current.set(requestId, resolve),
      );
      try {
        socket.send(JSON.stringify({ ...request, requestId }));
      } catch {
        pendingTemplateResults.current.delete(requestId);
        return Promise.resolve({ status: 'failed', error: 'The bridge connection closed.' });
      }
      return result;
    },
    [],
  );

  return {
    state,
    error,
    closeInSeconds,
    bridgeUrl,
    initialMarkdown,
    feedbackLoop,
    attachmentUrl,
    attachmentToken,
    templateSnapshot,
    requestTemplateChange,
    submit,
  };
}
