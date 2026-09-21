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
  vi.useRealTimers();
  vi.restoreAllMocks();
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

describe('명령 편집기', () => {
  it('세션 토큰이 없으면 오류를 표시하고 전송을 막는다', () => {
    render(<App />);

    expect(screen.getByRole('status')).toHaveTextContent('needs a bridge session token');
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('브리지 오리진에 맞는 WebSocket을 연결한다', () => {
    const socket = renderWithSession('https://127.0.0.1:4321');

    expect(socket.url).toBe('wss://127.0.0.1:4321/ws');
  });

  it('연결되면 명령 입력창 하나와 전송 버튼만 표시한다', async () => {
    renderWithSession();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Command editor ready');
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Send command' })).toBeDisabled();
    });
    expect(screen.queryByRole('heading', { name: /response/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('입력한 명령의 앞뒤 공백을 제거해 전송한다', async () => {
    const socket = renderWithSession();
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Fix the tests  ' } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Send command' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Send command' }));

    expect(socket.send).toHaveBeenLastCalledWith(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000004',
        prompt: 'Fix the tests',
      }),
    );
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('명령을 전송하면 3초 뒤 브라우저 창을 닫는다', () => {
    vi.useFakeTimers();
    renderWithSession();
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Run the tests' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send command' }));

    expect(closeSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_999);
    expect(closeSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('명령 접수 결과가 성공이면 성공 상태를 표시한다', async () => {
    const socket = renderWithSession();
    socket.emit(
      'message',
      JSON.stringify({
        type: 'prompt.result',
        submissionId: '00000000-0000-4000-8000-000000000004',
        status: 'accepted',
      }),
    );

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Command sent'));
  });

  it('서버가 명령을 거부하면 오류를 표시한다', async () => {
    const socket = renderWithSession();
    socket.emit(
      'message',
      JSON.stringify({
        type: 'prompt.result',
        submissionId: '00000000-0000-4000-8000-000000000004',
        status: 'failed',
        error: 'Command rejected',
      }),
    );

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Command rejected'));
  });

  it('잘못된 JSON 메시지를 받으면 프로토콜 오류를 표시한다', async () => {
    const socket = renderWithSession();
    socket.emit('message', '{not-json');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('returned an invalid message'),
    );
  });

  it('WebSocket 오류와 종료를 각각 표시한다', async () => {
    const socket = renderWithSession();
    socket.emit('error', undefined);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not connect'));

    socket.emit('close', undefined);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Bridge connection closed'),
    );
  });
});
