import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';

const crepeTestState = vi.hoisted(() => {
  const state: { instance: MockCrepe | undefined; createError: Error | undefined } = {
    instance: undefined,
    createError: undefined,
  };

  class MockCrepe {
    public static readonly Feature = {
      ImageBlock: 'image-block',
      Placeholder: 'placeholder',
    } as const;

    public readonly options: Record<string, unknown>;
    public readonly destroy = vi.fn(async () => undefined);
    private markdown: string;
    private markdownUpdated:
      ((ctx: unknown, markdown: string, previousMarkdown: string) => void) | undefined;
    private editorElement: HTMLElement | undefined;

    public constructor(options: Record<string, unknown>) {
      this.options = options;
      this.markdown = String(options['defaultValue'] ?? '');
      state.instance = this;
    }

    public setReadonly(readOnly: boolean): this {
      this.editorElement?.setAttribute('contenteditable', String(!readOnly));
      return this;
    }

    public on(configure: {
      (listener: {
        markdownUpdated: (
          callback: (ctx: unknown, markdown: string, previousMarkdown: string) => void,
        ) => void;
      }): void;
    }): this {
      configure({
        markdownUpdated: (callback) => {
          this.markdownUpdated = callback;
        },
      });
      return this;
    }

    public async create(): Promise<this> {
      if (state.createError !== undefined) throw state.createError;
      const root = this.options['root'];
      if (!(root instanceof HTMLElement)) throw new Error('Crepe root was not provided.');
      const editor = document.createElement('div');
      editor.className = 'ProseMirror';
      editor.setAttribute('contenteditable', 'true');
      editor.setAttribute('role', 'textbox');
      editor.setAttribute('aria-label', 'Command');
      editor.textContent = this.markdown;
      editor.addEventListener('input', () => {
        this.markdown = editor.textContent ?? '';
        this.markdownUpdated?.({}, this.markdown, '');
      });
      root.append(editor);
      this.editorElement = editor;
      return this;
    }

    public getMarkdown(): string {
      return this.markdown;
    }
  }

  return { MockCrepe, state };
});

vi.mock('@milkdown/crepe', () => ({ Crepe: crepeTestState.MockCrepe }));

import { App } from './App.js';

class MockWebSocket {
  public static readonly OPEN = 1;
  public static readonly CLOSED = 3;
  public static instance: MockWebSocket | undefined;
  public static instances: MockWebSocket[] = [];
  public readonly readyState = MockWebSocket.OPEN;
  public readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  public readonly url: string;
  public readonly send = vi.fn();
  public readonly close = vi.fn();

  public constructor(url: string) {
    this.url = url;
    MockWebSocket.instance = this;
    MockWebSocket.instances.push(this);
  }

  public addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    if (type === 'open') listener(new MessageEvent('open'));
  }

  public removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter(
        (registeredListener) => registeredListener !== listener,
      ),
    );
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
  MockWebSocket.instances = [];
  crepeTestState.state.instance = undefined;
  crepeTestState.state.createError = undefined;
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
  fireEvent.pointerEnter(screen.getByRole('button', { name: 'Markdown command editor' }));
  return socket;
}

async function editMarkdown(markdown: string): Promise<void> {
  const editor = await screen.findByRole('textbox', { name: 'Command' });
  editor.textContent = markdown;
  fireEvent.input(editor);
}

describe('명령 편집기', () => {
  it('세션 토큰이 없으면 오류를 표시하고 전송을 막는다', () => {
    render(<App />);

    expect(screen.getByRole('status')).toHaveTextContent('needs a bridge session token');
    expect(screen.getByRole('button', { name: 'Send to Codex' })).toBeDisabled();
  });

  it('잘못된 브리지 URL이면 화면을 유지하고 오류 상태를 표시한다', async () => {
    window.history.replaceState({}, '', '/?token=test-token&bridge=%25');

    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('bridge URL is invalid'),
    );
    expect(screen.getByRole('button', { name: 'Send to Codex' })).toBeDisabled();
  });

  it('에디터 영역에 포인터가 들어오면 지연된 Markdown 편집기를 표시한다', async () => {
    render(<App />);

    const editorPlaceholder = screen.getByRole('button', { name: 'Markdown command editor' });
    fireEvent.pointerEnter(editorPlaceholder);

    expect(await screen.findByRole('textbox', { name: 'Command' })).toBeInTheDocument();
  });

  it('브리지 오리진에 맞는 WebSocket을 연결한다', () => {
    const socket = renderWithSession('https://127.0.0.1:4321');

    expect(socket.url).toBe('wss://127.0.0.1:4321/ws');
  });

  it('원격 브리지 URL이면 WebSocket 연결을 만들지 않는다', async () => {
    window.history.replaceState({}, '', '/?token=test-token&bridge=https%3A%2F%2Fbridge.example');
    vi.stubGlobal('WebSocket', MockWebSocket);

    render(<App />);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('loopback host'));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('Strict Mode에서 폐기된 연결이 활성 연결 상태를 덮어쓰지 않는다', async () => {
    window.history.replaceState({}, '', '/?token=test-token&bridge=http%3A%2F%2F127.0.0.1%3A4321');
    vi.stubGlobal('WebSocket', MockWebSocket);

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    const [discardedConnection, activeConnection] = MockWebSocket.instances;
    if (discardedConnection === undefined || activeConnection === undefined) {
      throw new Error('Strict Mode did not create both WebSocket connections.');
    }

    expect(activeConnection.url).toBe('ws://127.0.0.1:4321/ws');
    activeConnection.emit(
      'message',
      JSON.stringify({
        type: 'session.ready',
        sessionId: '00000000-0000-4000-8000-000000000005',
        expiresAt: '2026-09-20T00:00:00.000Z',
      }),
    );
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Connected'));

    discardedConnection.emit('close', undefined);

    expect(screen.getByRole('status')).toHaveTextContent('Connected');
  });

  it('연결되면 Markdown 편집기와 비활성 전송 버튼을 표시한다', async () => {
    renderWithSession();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Connected');
      expect(screen.getByRole('textbox', { name: 'Command' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send to Codex' })).toBeDisabled();
    });
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Prompt actions' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Prompt editor' })).toBeInTheDocument();
    expect(screen.queryByText('New prompt')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /textarea/i })).not.toBeInTheDocument();
  });

  it('Markdown 이미지 URL을 포함한 문서를 앞뒤 공백 없이 전송한다', async () => {
    const socket = renderWithSession();
    const markdown = '  # Fix the tests\n\n![diagram](https://example.com/diagram.png)  ';

    await editMarkdown(markdown);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send to Codex' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));

    expect(socket.send).toHaveBeenLastCalledWith(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000004',
        prompt: '# Fix the tests\n\n![diagram](https://example.com/diagram.png)',
      }),
    );
  });

  it('문서를 보내는 동안 편집기와 전송 버튼을 잠근다', async () => {
    const socket = renderWithSession();

    await editMarkdown('Run the tests');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send to Codex' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));

    expect(socket.send).toHaveBeenLastCalledWith(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000004',
        prompt: 'Run the tests',
      }),
    );
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    expect(screen.getByTestId('markdown-editor')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('textbox', { name: 'Command' })).toHaveAttribute(
      'contenteditable',
      'false',
    );
  });

  it('빈 문서에서는 전송 버튼을 비활성화한다', async () => {
    renderWithSession();

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Command' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Send to Codex' })).toBeDisabled();
  });

  it('12,000자를 초과한 Markdown은 제출 시 오류를 표시한다', async () => {
    renderWithSession();

    await editMarkdown('a'.repeat(12_001));

    const sendButton = await screen.findByRole('button', { name: 'Send to Codex' });
    expect(sendButton).toBeEnabled();

    fireEvent.click(sendButton);

    expect(screen.getByRole('alert')).toHaveTextContent('12,000 characters or fewer');
  });

  it('Crepe 설정에서 파일 이미지 업로드를 끈다', async () => {
    renderWithSession();

    await waitFor(() => expect(crepeTestState.state.instance).toBeDefined());
    expect(crepeTestState.state.instance?.options['features']).toMatchObject({
      'image-block': false,
    });
    expect(screen.queryByText('Images: use Markdown URLs')).not.toBeInTheDocument();
  });

  it('이미지 파일을 붙여넣으면 브라우저 첨부를 막는다', async () => {
    renderWithSession();

    const editor = await screen.findByRole('textbox', { name: 'Command' });
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { files: [new File(['binary'], 'image.png', { type: 'image/png' })] },
    });

    editor.dispatchEvent(pasteEvent);

    expect(pasteEvent.defaultPrevented).toBe(true);
  });

  it('명령 접수 후 3초 카운트다운 모달을 표시하고 창을 닫는다', async () => {
    const socket = renderWithSession();
    await screen.findByRole('textbox', { name: 'Command' });
    vi.useFakeTimers();
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    const editor = screen.getByRole('textbox', { name: 'Command' });
    editor.textContent = 'Run the tests';
    fireEvent.input(editor);
    expect(screen.getByRole('button', { name: 'Send to Codex' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));

    expect(closeSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => {
      socket.emit(
        'message',
        JSON.stringify({
          type: 'prompt.result',
          submissionId: '00000000-0000-4000-8000-000000000004',
          status: 'accepted',
        }),
      );
    });

    expect(screen.getByRole('dialog')).toHaveTextContent('3초 후 이 창이 닫힙니다.');
    await act(async () => vi.advanceTimersByTime(999));
    expect(closeSpy).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole('dialog')).toHaveTextContent('2초 후 이 창이 닫힙니다.');
    await act(async () => vi.advanceTimersByTime(2_000));
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

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sent'));
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
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('잘못된 JSON 메시지를 받으면 프로토콜 오류를 표시한다', async () => {
    const socket = renderWithSession();
    socket.emit('message', '{not-json');

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('returned an invalid message'),
    );
  });

  it('WebSocket 오류가 발생하면 연결 종료 후에도 오류 상태를 유지한다', async () => {
    const socket = renderWithSession();
    socket.emit('error', undefined);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not connect'));

    socket.emit('close', undefined);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not connect'));
  });

  it('Crepe 초기화가 실패하면 편집기 오류와 재시도 안내를 표시한다', async () => {
    crepeTestState.state.createError = new Error('Crepe initialization failed.');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderWithSession();

    expect(
      await screen.findByText('Editor failed to load. Reload to try again.'),
    ).toBeInTheDocument();
  });

  it('React가 편집기를 제거하면 Crepe 인스턴스를 destroy한다', async () => {
    renderWithSession();

    await waitFor(() => expect(crepeTestState.state.instance).toBeDefined());
    const instance = crepeTestState.state.instance;
    cleanup();

    expect(instance?.destroy).toHaveBeenCalledOnce();
  });

  it('AI Feedback Mode로 전환하면 Markdown을 읽기 전용으로 표시한다', async () => {
    renderWithSession();
    await editMarkdown('# Review this');
    expect(screen.getByTestId('markdown-editor')).toHaveClass('markdown-content');

    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    expect(screen.getByRole('tab', { name: 'AI Feedback Mode' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('heading', { name: 'Review this' })).toBeInTheDocument();
    expect(screen.getByTestId('annotated-markdown')).not.toHaveTextContent('# Review this');
    expect(screen.getByTestId('annotated-markdown')).toHaveClass('markdown-content');
    expect(screen.queryByRole('textbox', { name: 'Command' })).not.toBeInTheDocument();
  });

  it('global feedback을 추가하면 feedback 목록과 전송 버튼의 개수를 갱신한다', async () => {
    renderWithSession();
    await editMarkdown('# Review this');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add global feedback' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Global feedback' }), {
      target: { value: 'Make the title more specific.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));

    expect(screen.getByRole('region', { name: 'Prompt actions' })).toHaveTextContent(
      'Send Feedback (1)',
    );
    expect(screen.getByRole('complementary', { name: 'Feedback list' })).toHaveTextContent(
      'Make the title more specific.',
    );
    expect(screen.getByRole('button', { name: 'Edit global feedback' })).toHaveTextContent('Added');
  });

  it('기존 global feedback을 다시 열면 새 항목 대신 기존 내용을 수정한다', async () => {
    renderWithSession();
    await editMarkdown('# Review this');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add global feedback' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Global feedback' }), {
      target: { value: 'Make the title more specific.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit global feedback' }));

    const composer = screen.getByRole('textbox', { name: 'Global feedback' });
    expect(composer).toHaveValue('Make the title more specific.');
    fireEvent.change(composer, { target: { value: 'Use a concise title.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));

    expect(screen.getByRole('complementary', { name: 'Feedback list' })).toHaveTextContent(
      'Use a concise title.',
    );
    expect(screen.getByRole('complementary', { name: 'Feedback list' })).not.toHaveTextContent(
      'Make the title more specific.',
    );
    expect(screen.getByRole('region', { name: 'Prompt actions' })).toHaveTextContent(
      'Send Feedback (1)',
    );
  });

  it('문서에서 텍스트를 선택하면 선택 영역 위에 feedback tooltip을 표시한다', async () => {
    renderWithSession();
    await editMarkdown('# Review this\n\nSecond paragraph');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const article = screen.getByTestId('annotated-markdown');
    const textNode = article.querySelector('h1 span')?.firstChild;
    if (!(textNode instanceof Text)) throw new Error('Rendered heading text was not found.');
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.mouseUp(article);

    expect(
      await screen.findByRole('textbox', { name: 'Feedback on selection' }),
    ).toBeInTheDocument();
    expect(within(article).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(article).getByText('Review this')).toBeInTheDocument();
  });

  it('feedback을 전송하면 최신 Markdown으로 Edit Mode를 다시 연다', async () => {
    const socket = renderWithSession();
    await editMarkdown('# Review this');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add global feedback' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Global feedback' }), {
      target: { value: 'Use a stronger title.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Send Feedback (1)' }));
    expect(socket.send).toHaveBeenLastCalledWith(expect.stringContaining('"mode":"feedback"'));
    await act(async () => {
      socket.emit(
        'message',
        JSON.stringify({
          type: 'prompt.result',
          submissionId: '00000000-0000-4000-8000-000000000004',
          status: 'accepted',
          prompt: '# Updated by Codex',
          nextSession: {
            token: 'a'.repeat(43),
            sessionId: '00000000-0000-4000-8000-000000000006',
            expiresAt: '2026-09-20T00:00:00.000Z',
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Edit Mode' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByRole('textbox', { name: 'Command' })).toHaveTextContent(
        '# Updated by Codex',
      );
    });
    expect(screen.queryByText('Make the title more specific.')).not.toBeInTheDocument();
    expect(openSpy).toHaveBeenCalledOnce();
    expect(new URL(openSpy.mock.calls[0]?.[0] ?? '').searchParams.get('markdown')).toBe(
      '# Updated by Codex',
    );
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('제출 전에 미전송 feedback 경고에서 Approve anyway를 선택하면 일반 제출을 보낸다', async () => {
    const socket = renderWithSession();
    await editMarkdown('Submit this document');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add global feedback' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Global feedback' }), {
      target: { value: 'Ignore this for now.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve anyway' }));

    expect(socket.send).toHaveBeenLastCalledWith(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000004',
        prompt: 'Submit this document',
      }),
    );
  });
});
