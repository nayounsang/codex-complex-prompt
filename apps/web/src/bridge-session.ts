import { useCallback, useEffect, useState } from 'react';

import { ServerMessageSchema } from '@codex-complex-prompt/protocol';
import type { ReviewSubmit } from '@codex-complex-prompt/protocol';

export type ConnectionState =
  'connecting' | 'connected' | 'submitting' | 'success' | 'error' | 'disconnected';

interface BridgeSession {
  readonly state: ConnectionState;
  readonly error: string | null;
  readonly submit: (prompt: string) => void;
  readonly review: ReviewState | null;
  readonly submitReview: (decision: ReviewSubmit['decision'], feedback?: string) => void;
}

export interface ReviewState {
  readonly reviewId: string;
  readonly title: string;
  readonly content: string;
}

export function useBridgeSession(): BridgeSession {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);

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
        input = JSON.parse(String(event.data)) as unknown;
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
      } else if (message.data.type === 'review.ready') {
        setReview(message.data);
        setState('connected');
        setError(null);
      } else if (message.data.type === 'prompt.result') {
        if (message.data.status === 'accepted') {
          setState('success');
          setError(null);
        } else {
          setState('error');
          setError(message.data.error ?? 'The prompt could not be submitted.');
        }
      } else if (message.data.type === 'review.result') {
        setState(message.data.decision === 'approved' ? 'success' : 'error');
        setError(
          message.data.decision === 'approved'
            ? null
            : (message.data.feedback ?? 'The browser review was rejected.'),
        );
      } else {
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
    return () => connection.close();
  }, []);

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

  const submitReview = useCallback(
    (decision: ReviewSubmit['decision'], feedback?: string): void => {
      /* c8 ignore next -- review actions are disabled until the authenticated review is ready. */
      if (socket === null || socket.readyState !== WebSocket.OPEN || review === null) return;
      setState('submitting');
      setError(null);
      socket.send(
        JSON.stringify({
          type: 'review.submit',
          reviewId: review.reviewId,
          decision,
          ...(feedback === undefined ? {} : { feedback: feedback.trim() }),
        }),
      );
    },
    [review, socket],
  );

  return { state, error, submit, review, submitReview };
}
