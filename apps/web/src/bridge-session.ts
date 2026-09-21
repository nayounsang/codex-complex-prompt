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

export function useBridgeSession(): BridgeSession {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [closeInSeconds, setCloseInSeconds] = useState<number | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const countdownTimer = useRef<number | undefined>(undefined);

  function clearCloseTimers(): void {
    if (closeTimer.current !== undefined) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
    if (countdownTimer.current !== undefined) {
      window.clearInterval(countdownTimer.current);
      countdownTimer.current = undefined;
    }
  }

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const token = searchParams.get('token');
    if (token === null) {
      setState('error');
      setError('This page needs a bridge session token.');
      return;
    }
    const cleanUrl = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState({}, document.title, cleanUrl);
    const bridgeOrigin = new URL(searchParams.get('bridge') ?? window.location.origin);
    const protocol = bridgeOrigin.protocol === 'https:' ? 'wss:' : 'ws:';
    const connection = new WebSocket(`${protocol}//${bridgeOrigin.host}/ws`);
    setSocket(connection);
    connection.addEventListener('open', () => {
      connection.send(JSON.stringify({ type: 'session.handshake', token }));
    });
    connection.addEventListener('message', (event) => {
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
    });
    connection.addEventListener('close', () => {
      setSocket(null);
      setState((current) => (current === 'success' ? current : 'disconnected'));
    });
    connection.addEventListener('error', () => {
      setState('error');
      setError('Could not connect to the local bridge.');
    });
    return () => {
      clearCloseTimers();
      connection.close();
    };
  }, []);

  useEffect(() => clearCloseTimers, []);

  const submit = useCallback(
    (prompt: string): void => {
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
    },
    [socket],
  );

  return { state, error, closeInSeconds, submit };
}
