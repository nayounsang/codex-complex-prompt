import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';

class MockWebSocket {
  public static readonly OPEN = 1;
  public static readonly CLOSED = 3;
  public static instance: MockWebSocket | undefined;
  public readonly readyState = MockWebSocket.OPEN;
  public readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  public readonly url: string;
  public readonly send = vi.fn();
  public readonly close = vi.fn();

  public constructor(url: string) {
    this.url = url;
    MockWebSocket.instance = this;
  }

  public addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    if (type === 'open') listener(new MessageEvent('open'));
  }

  public emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }
}

afterEach(() => {
  cleanup();
  MockWebSocket.instance = undefined;
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

function renderWithSession(bridge = 'http://127.0.0.1:4321'): MockWebSocket {
  window.history.replaceState({}, '', `/?token=test-token&bridge=${encodeURIComponent(bridge)}`);
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000004' });

  render(<App />);
  const socket = MockWebSocket.instance;
  if (socket === undefined) throw new Error('Mock WebSocket was not created.');
  socket.emit(
    'message',
    JSON.stringify({
      type: 'session.ready',
      sessionId: '00000000-0000-4000-8000-000000000005',
      expiresAt: '2026-09-20T00:00:00.000Z',
    }),
  );
  return socket;
}

describe('prompt editor', () => {
  it('session token이 없으면 오류를 표시하고 제출을 막는다', () => {
    render(<App />);

    expect(screen.getByRole('status')).toHaveTextContent('needs a bridge session token');
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('bridge query parameter의 origin으로 WebSocket을 연결한다', () => {
    const socket = renderWithSession('http://127.0.0.1:4321');

    expect(socket.url).toBe('ws://127.0.0.1:4321/ws');
  });

  it('HTTPS bridge origin에는 보안 WebSocket을 연결한다', () => {
    const socket = renderWithSession('https://127.0.0.1:4321');

    expect(socket.url).toBe('wss://127.0.0.1:4321/ws');
  });

  it('handshake가 성공하면 prompt 제출 버튼을 활성화한다', async () => {
    renderWithSession();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft prompt' } });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Connected');
      expect(screen.getByRole('button')).toBeEnabled();
    });
  });

  it('사용자가 입력한 prompt를 trim한 뒤 전송한다', async () => {
    const socket = renderWithSession();
    const textarea = screen.getByRole('textbox');

    fireEvent.change(textarea, { target: { value: '  Improve this  ' } });
    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
    fireEvent.click(screen.getByRole('button'));

    expect(socket.send).toHaveBeenLastCalledWith(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000004',
        prompt: 'Improve this',
      }),
    );
  });

  it('server가 실패 결과를 보내면 오류 메시지를 표시한다', async () => {
    const socket = renderWithSession();

    socket.emit(
      'message',
      JSON.stringify({
        type: 'prompt.result',
        submissionId: '00000000-0000-4000-8000-000000000004',
        status: 'failed',
        error: 'Prompt rejected',
      }),
    );

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Prompt rejected'));
  });

  it('server가 성공 결과를 보내면 성공 상태를 표시한다', async () => {
    const socket = renderWithSession();

    socket.emit(
      'message',
      JSON.stringify({
        type: 'prompt.result',
        submissionId: '00000000-0000-4000-8000-000000000004',
        status: 'accepted',
      }),
    );

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('sent successfully'));
  });

  it('server가 오류 메시지를 보내면 해당 메시지를 표시한다', async () => {
    const socket = renderWithSession();

    socket.emit(
      'message',
      JSON.stringify({
        type: 'session.error',
        code: 'invalid_message',
        message: 'Message rejected',
      }),
    );

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Message rejected'));
  });

  it('실패 결과에 오류 메시지가 없으면 기본 오류를 표시한다', async () => {
    const socket = renderWithSession();

    socket.emit(
      'message',
      JSON.stringify({
        type: 'prompt.result',
        submissionId: '00000000-0000-4000-8000-000000000004',
        status: 'failed',
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('could not be submitted'),
    );
  });

  it('server가 잘못된 메시지를 보내면 protocol 오류를 표시한다', async () => {
    const socket = renderWithSession();

    socket.emit('message', JSON.stringify({ type: 'unknown' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('returned an invalid message'),
    );
  });

  it('WebSocket 메시지가 JSON이 아니면 protocol 오류를 표시한다', async () => {
    const socket = renderWithSession();

    socket.emit('message', '{not-json');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('returned an invalid message'),
    );
  });

  it('WebSocket 오류가 발생하면 연결 오류를 표시한다', async () => {
    const socket = renderWithSession();

    socket.emit('error', undefined);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not connect'));
  });

  it('WebSocket이 종료되면 연결 종료 상태를 표시한다', async () => {
    const socket = renderWithSession();

    socket.emit('close', undefined);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Bridge connection closed'),
    );
  });

  it('성공 상태에서 WebSocket이 종료되어도 성공 상태를 유지한다', async () => {
    const socket = renderWithSession();
    socket.emit(
      'message',
      JSON.stringify({
        type: 'prompt.result',
        submissionId: '00000000-0000-4000-8000-000000000004',
        status: 'accepted',
      }),
    );
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('sent successfully'));

    socket.emit('close', undefined);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('sent successfully'));
  });
});
