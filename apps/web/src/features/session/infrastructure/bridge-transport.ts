import { ServerMessageSchema, type ServerMessage } from '@codex-complex-prompt/protocol';

export interface BridgeTransportHandlers {
  readonly onMessage: (socket: WebSocket, message: ServerMessage) => void;
  readonly onInvalidMessage: (socket: WebSocket) => void;
  readonly onClose: (socket: WebSocket) => void;
  readonly onError: (socket: WebSocket) => void;
}

export interface BridgeTransport {
  readonly socket: WebSocket;
  readonly close: () => void;
}

export function connectBridgeTransport(
  bridgeUrl: URL,
  token: string,
  handlers: BridgeTransportHandlers,
): BridgeTransport {
  const protocol = bridgeUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${bridgeUrl.host}/ws`);

  function handleOpen(): void {
    socket.send(JSON.stringify({ type: 'session.handshake', token }));
  }

  function handleMessage(event: MessageEvent): void {
    let input: unknown;
    try {
      input = JSON.parse(String(event.data));
    } catch {
      handlers.onInvalidMessage(socket);
      return;
    }
    const parsed = ServerMessageSchema.safeParse(input);
    if (!parsed.success) {
      handlers.onInvalidMessage(socket);
      return;
    }
    handlers.onMessage(socket, parsed.data);
  }

  function handleClose(): void {
    handlers.onClose(socket);
  }

  function handleError(): void {
    handlers.onError(socket);
  }

  socket.addEventListener('open', handleOpen);
  socket.addEventListener('message', handleMessage);
  socket.addEventListener('close', handleClose);
  socket.addEventListener('error', handleError);

  return {
    socket,
    close: () => {
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('message', handleMessage);
      socket.removeEventListener('close', handleClose);
      socket.removeEventListener('error', handleError);
      socket.close();
    },
  };
}
