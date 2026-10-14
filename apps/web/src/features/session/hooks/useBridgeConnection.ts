import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ClientMessage, ServerMessage } from '@codex-complex-prompt/protocol';

import { connectBridgeTransport } from '../infrastructure/bridge-transport.js';
import { parseBridgeUrl } from './bridge-url.js';

export interface BridgeConnectionHandlers {
  readonly onMessage: (message: ServerMessage, send: (message: ClientMessage) => void) => void;
  readonly onInvalidMessage: () => void;
  readonly onClose: () => void;
  readonly onError: () => void;
  readonly onCleanup: () => void;
}

export interface BridgeConnection {
  readonly bridgeUrl: string | null;
  readonly isOpen: () => boolean;
  readonly send: (message: ClientMessage) => void;
}

export function useBridgeConnection({
  onMessage,
  onInvalidMessage,
  onClose,
  onError,
  onCleanup,
}: BridgeConnectionHandlers): BridgeConnection {
  const tokenRef = useRef<string | null>(null);
  const bridgeRef = useRef<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [bridgeUrl, setBridgeUrl] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('bridge') ?? window.location.origin;
  });

  const isOpen = useCallback((): boolean => socketRef.current?.readyState === WebSocket.OPEN, []);

  const send = useCallback((message: ClientMessage): void => {
    const socket = socketRef.current;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      throw new Error('The bridge is not connected.');
    }
    socket.send(JSON.stringify(message));
  }, []);

  useEffect(
    function connectToBridge() {
      const searchParams = new URLSearchParams(window.location.search);
      const token = tokenRef.current ?? searchParams.get('token');
      if (token === null) return;
      tokenRef.current = token;

      const bridge = bridgeRef.current ?? searchParams.get('bridge') ?? window.location.origin;
      const bridgeResult = parseBridgeUrl(bridge);
      if (bridgeResult.url === null) return;
      bridgeRef.current = bridge;
      setBridgeUrl(bridge);

      if (searchParams.has('token')) {
        window.history.replaceState(
          {},
          document.title,
          `${window.location.pathname}${window.location.hash}`,
        );
      }

      const transport = connectBridgeTransport(bridgeResult.url, token, {
        onMessage: (connection, message) => {
          if (socketRef.current === connection) onMessage(message, send);
        },
        onInvalidMessage: (connection) => {
          if (socketRef.current === connection) onInvalidMessage();
        },
        onClose: (connection) => {
          if (socketRef.current !== connection) return;
          socketRef.current = null;
          onClose();
        },
        onError: (connection) => {
          if (socketRef.current === connection) onError();
        },
      });
      const connection = transport.socket;
      socketRef.current = connection;

      return function cleanupBridgeConnection() {
        if (socketRef.current === connection) socketRef.current = null;
        onCleanup();
        transport.close();
      };
    },
    [onMessage, onInvalidMessage, onClose, onError, onCleanup, send],
  );

  return useMemo(() => ({ bridgeUrl, isOpen, send }), [bridgeUrl, isOpen, send]);
}
