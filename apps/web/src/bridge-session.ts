import { useCallback, useEffect, useRef, useState } from 'react';

import { ServerMessageSchema } from '@codex-complex-prompt/protocol';

const COMMAND_WINDOW_CLOSE_DELAY_MS = 3_000;

export type ConnectionState =
  'connecting' | 'connected' | 'submitting' | 'success' | 'error' | 'disconnected';

interface BridgeSession {
  readonly state: ConnectionState;
  readonly error: string | null;
  readonly closeInSeconds: number | null;
  readonly submit: (prompt: string) => void;
}

interface BridgeUrlResult {
  readonly url: URL | null;
  readonly error: string | null;
}

function parseBridgeUrl(bridge: string): BridgeUrlResult {
  let url: URL;
  try {
    url = new URL(bridge);
  } catch {
    return { url: null, error: 'The bridge URL is invalid.' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { url: null, error: 'The bridge URL must use HTTP or HTTPS.' };
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isLoopbackHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (url.protocol === 'http:' && !isLoopbackHost) {
    return { url: null, error: 'Remote bridge URLs must use HTTPS.' };
  }
  return { url, error: null };
}

function getInitialConnection(): { state: ConnectionState; error: string | null } {
  if (typeof window === 'undefined') return { state: 'connecting', error: null };
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get('token') === null) {
    return { state: 'error', error: 'This page needs a bridge session token.' };
  }
  const bridgeResult = parseBridgeUrl(searchParams.get('bridge') ?? window.location.origin);
  return bridgeResult.error === null
    ? { state: 'connecting', error: null }
    : { state: 'error', error: bridgeResult.error };
}

export function useBridgeSession(): BridgeSession {
  const [state, setState] = useState<ConnectionState>(() => getInitialConnection().state);
  const [error, setError] = useState<string | null>(() => getInitialConnection().error);
  const [closeInSeconds, setCloseInSeconds] = useState<number | null>(null);
  const tokenRef = useRef<string | null>(null);
  const bridgeRef = useRef<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const countdownTimer = useRef<number | undefined>(undefined);

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
      const cleanUrl = `${window.location.pathname}${window.location.hash}`;
      if (searchParams.has('token')) {
        window.history.replaceState({}, document.title, cleanUrl);
      }
      const protocol = bridgeOrigin.protocol === 'https:' ? 'wss:' : 'ws:';
      const connection = new WebSocket(`${protocol}//${bridgeOrigin.host}/ws`);
      socketRef.current = connection;

      function handleOpen(): void {
        if (socketRef.current !== connection) return;
        connection.send(JSON.stringify({ type: 'session.handshake', token }));
      }

      function handleMessage(event: MessageEvent): void {
        if (socketRef.current !== connection) return;
        let input: unknown;
        try {
          input = JSON.parse(String(event.data));
        } catch {
          setState('error');
          setError('The bridge returned an invalid message.');
          return;
        }
        const message = ServerMessageSchema.safeParse(input);
        if (!message.success) {
          setState('error');
          setError('The bridge returned an invalid message.');
          return;
        }
        if (message.data.type === 'session.ready') {
          setState('connected');
          setError(null);
        } else if (message.data.type === 'prompt.result') {
          if (message.data.status === 'accepted') {
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
            setError(message.data.error ?? 'The command could not be sent.');
            clearCloseTimers();
            setCloseInSeconds(null);
          }
        } else if (message.data.type === 'session.error') {
          setState('error');
          setError(message.data.message);
        }
      }

      function handleClose(): void {
        if (socketRef.current !== connection) return;
        socketRef.current = null;
        setState((current) =>
          current === 'success' || current === 'error' ? current : 'disconnected',
        );
      }

      function handleError(): void {
        if (socketRef.current !== connection) return;
        setState('error');
        setError('Could not connect to the local bridge.');
      }

      connection.addEventListener('open', handleOpen);
      connection.addEventListener('message', handleMessage);
      connection.addEventListener('close', handleClose);
      connection.addEventListener('error', handleError);

      return function cleanupBridgeConnection() {
        clearCloseTimers();
        connection.removeEventListener('open', handleOpen);
        connection.removeEventListener('message', handleMessage);
        connection.removeEventListener('close', handleClose);
        connection.removeEventListener('error', handleError);
        if (socketRef.current === connection) {
          socketRef.current = null;
        }
        connection.close();
      };
    },
    [clearCloseTimers],
  );

  const submit = useCallback((prompt: string): void => {
    const socket = socketRef.current;
    /* c8 ignore next -- the button disables this path when no authenticated socket exists. */
    if (socket === null || socket.readyState !== WebSocket.OPEN || prompt.trim() === '') return;
    setState('submitting');
    setError(null);
    socket.send(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: crypto.randomUUID(),
        prompt: prompt.trim(),
      }),
    );
  }, []);

  return { state, error, closeInSeconds, submit };
}
