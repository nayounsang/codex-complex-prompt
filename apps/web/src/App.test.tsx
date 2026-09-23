import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';

const crepeTestState = vi.hoisted(() => {
  function renderMockMarkdown(root: HTMLElement, markdown: string): void {
    root.replaceChildren();
    const lines = markdown.split('\n');
    let index = 0;
    while (index < lines.length) {
      const line = lines[index] ?? '';
      if (line.trim() === '') {
        index += 1;
        continue;
      }
      if (/^\s*```/.test(line)) {
        const pre = document.createElement('pre');
        pre.className = 'milkdown-code-block';
        const code = document.createElement('code');
        code.className = 'cm-content';
        const end = lines.findIndex(
          (candidate, candidateIndex) => candidateIndex > index && /^\s*```/.test(candidate),
        );
        code.textContent = lines.slice(index + 1, end === -1 ? lines.length : end).join('\n');
        pre.append(code);
        root.append(pre);
        index = end === -1 ? lines.length : end + 1;
        continue;
      }
      const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
      if (heading !== null) {
        const headingElement = document.createElement(`h${heading[1]?.length ?? 1}`);
        appendMockInline(headingElement, heading[2] ?? '');
        root.append(headingElement);
        index += 1;
        continue;
      }
      if (line.includes('|') && /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[index + 1] ?? '')) {
        const tableBlock = document.createElement('div');
        tableBlock.className = 'milkdown-table-block';
        const table = document.createElement('table');
        const head = document.createElement('thead');
        const body = document.createElement('tbody');
        appendMockTableRow(head, line, 'th');
        index += 2;
        while (index < lines.length && (lines[index] ?? '').includes('|')) {
          appendMockTableRow(body, lines[index] ?? '', 'td');
          index += 1;
        }
        table.append(head, body);
        tableBlock.append(table);
        root.append(tableBlock);
        continue;
      }
      const task = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
      if (task !== null) {
        const list = document.createElement('ul');
        list.className = 'task-list';
        const item = document.createElement('li');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = (task[1] ?? '').toLowerCase() === 'x';
        checkbox.disabled = true;
        item.append(checkbox);
        appendMockInline(item, task[2] ?? '');
        list.append(item);
        root.append(list);
        index += 1;
        continue;
      }
      const listItem = line.match(/^\s*([-*+]|\d+[.])\s+(.+)$/);
      if (listItem !== null) {
        const list = document.createElement(/^\d/.test(listItem[1] ?? '') ? 'ol' : 'ul');
        const item = document.createElement('li');
        appendMockInline(item, listItem[2] ?? '');
        list.append(item);
        root.append(list);
        index += 1;
        continue;
      }
      const paragraph = document.createElement('p');
      appendMockInline(paragraph, line);
      root.append(paragraph);
      index += 1;
    }
  }

  function appendMockTableRow(root: HTMLElement, line: string, cellTag: 'th' | 'td'): void {
    const row = document.createElement('tr');
    const cells = line
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|');
    for (const cellText of cells) {
      const cell = document.createElement(cellTag);
      appendMockInline(cell, cellText.trim());
      row.append(cell);
    }
    root.append(row);
  }

  function appendMockInline(root: HTMLElement, markdown: string): void {
    let cursor = 0;
    while (cursor < markdown.length) {
      const link = markdown.slice(cursor).match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (link !== null) {
        const anchor = document.createElement('a');
        anchor.href = link[2] ?? '';
        anchor.textContent = link[1] ?? '';
        root.append(anchor);
        cursor += link[0].length;
        continue;
      }
      const inlineCode = markdown.slice(cursor).match(/^`([^`]+)`/);
      if (inlineCode !== null) {
        const code = document.createElement('code');
        code.textContent = inlineCode[1] ?? '';
        root.append(code);
        cursor += inlineCode[0].length;
        continue;
      }
      const marker = markdown[cursor];
      if (marker === '*' || marker === '_') {
        const closing = markdown.indexOf(marker, cursor + 1);
        if (closing > cursor + 1) {
          const emphasis = document.createElement('em');
          emphasis.textContent = markdown.slice(cursor + 1, closing);
          root.append(emphasis);
          cursor = closing + 1;
          continue;
        }
      }
      const nextToken = markdown.slice(cursor).search(/[\[\]`*_]/);
      const end = nextToken === -1 ? markdown.length : cursor + Math.max(1, nextToken);
      root.append(document.createTextNode(markdown.slice(cursor, end)));
      cursor = end;
    }
  }

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
    private readOnly = false;
    private markdownUpdated:
      ((ctx: unknown, markdown: string, previousMarkdown: string) => void) | undefined;
    private editorElement: HTMLElement | undefined;

    public constructor(options: Record<string, unknown>) {
      this.options = options;
      this.markdown = String(options['defaultValue'] ?? '');
      state.instance = this;
    }

    public setReadonly(readOnly: boolean): this {
      this.readOnly = readOnly;
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
      editor.setAttribute('contenteditable', String(!this.readOnly));
      editor.setAttribute('role', 'textbox');
      editor.setAttribute('aria-label', 'Command');
      renderMockMarkdown(editor, this.markdown);
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
import { hasRenderedSourceMap } from './markdown-source-map.js';
import { restoreSelectionAnchor } from './selection-anchor.js';

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

function renderWithSession(
  bridge = 'http://127.0.0.1:4321',
  initialMarkdown?: string,
  feedbackLoop = false,
): MockWebSocket {
  const params = new URLSearchParams({ token: 'test-token', bridge });
  window.history.replaceState({}, '', `/?${params.toString()}`);
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000004' });

  render(<App />);
  const socket = MockWebSocket.instance;
  if (socket === undefined) throw new Error('Mock WebSocket was not created.');
  act(() => {
    socket.emit(
      'message',
      JSON.stringify({
        type: 'session.ready',
        sessionId: '00000000-0000-4000-8000-000000000005',
        expiresAt: '2026-09-20T00:00:00.000Z',
        ...(initialMarkdown === undefined ? {} : { initialMarkdown }),
        ...(feedbackLoop ? { feedbackLoop } : {}),
      }),
    );
  });
  const editorPlaceholder = screen.queryByRole('button', { name: 'Markdown command editor' });
  if (editorPlaceholder !== null) fireEvent.pointerEnter(editorPlaceholder);
  return socket;
}

function provideTemplateList(
  socket: MockWebSocket,
  templates: readonly { id: string; name: string; description: string; body: string }[],
  initialMarkdown = '',
  templatesError?: string,
): void {
  act(() => {
    socket.emit(
      'message',
      JSON.stringify({
        type: 'session.ready',
        sessionId: '00000000-0000-4000-8000-000000000005',
        expiresAt: '2026-09-20T00:00:00.000Z',
        initialMarkdown,
        templates,
        ...(templatesError === undefined ? {} : { templatesError }),
      }),
    );
  });
}

function selectSourceRange(root: HTMLElement, start: number, end: number): void {
  setSourceRange(root, start, end);
  fireEvent.mouseDown(root);
  fireEvent.mouseUp(root);
}

function setSourceRange(root: HTMLElement, start: number, end: number): void {
  const quote = root.textContent?.slice(start, end) ?? '';
  if (!restoreSelectionAnchor(root, { quote, start, end, rect: new DOMRect() })) {
    throw new Error('Source range was not rendered.');
  }
}

function selectCodeSourceRange(root: HTMLElement, start: number, end: number): void {
  const codeBlock = root.querySelector<HTMLElement>('.milkdown-code-block');
  const codeContent = codeBlock?.querySelector<HTMLElement>('.cm-content');
  const textNode = codeContent?.firstChild;
  const sourceStart = Number(codeBlock?.dataset['codeSourceStart']);
  if (!(textNode instanceof Text) || !Number.isFinite(sourceStart)) {
    throw new Error('Code source range was not rendered.');
  }
  const range = document.createRange();
  range.setStart(textNode, start - sourceStart);
  range.setEnd(textNode, end - sourceStart);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  fireEvent.mouseDown(root);
  fireEvent.mouseUp(root);
}

async function editMarkdown(markdown: string): Promise<void> {
  const editor = await screen.findByRole('textbox', { name: 'Command' });
  editor.textContent = markdown;
  fireEvent.input(editor);
}

describe('명령 편집기', () => {
  it('빈 프로젝트에서 템플릿 만들기를 선택하면 빈 Markdown 편집기를 연다', async () => {
    const socket = renderWithSession();
    provideTemplateList(socket, []);

    fireEvent.click(screen.getByRole('combobox', { name: 'Project template' }));
    fireEvent.click(await screen.findByRole('option', { name: /Create your first template/ }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Create template');
    expect(screen.getByRole('textbox', { name: 'Markdown body' })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('프로젝트 경로를 사용할 수 없으면 템플릿 사유를 표시하고 선택을 비활성화한다', () => {
    const socket = renderWithSession();
    provideTemplateList(
      socket,
      [],
      '',
      'The project directory was not provided by the Codex hook.',
    );

    expect(screen.getByRole('combobox', { name: 'Project template' })).toBeDisabled();
    expect(
      screen.getByText('The project directory was not provided by the Codex hook.'),
    ).toBeVisible();
  });

  it('새 템플릿을 저장하면 브리지 응답의 목록에 나타난다', async () => {
    const socket = renderWithSession();
    provideTemplateList(socket, []);
    fireEvent.click(screen.getByRole('combobox', { name: 'Project template' }));
    fireEvent.click(await screen.findByRole('option', { name: /Create your first template/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: '새 템플릿' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: '설명' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown body' }), {
      target: { value: '# 본문' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    const saveRequest = JSON.parse(String(socket.send.mock.calls.at(-1)?.[0])) as {
      requestId: string;
      template: { id: string; name: string; description: string; body: string };
    };
    expect(saveRequest).toMatchObject({
      type: 'template.save',
      template: { name: '새 템플릿', description: '설명', body: '# 본문' },
    });
    act(() =>
      socket.emit(
        'message',
        JSON.stringify({
          type: 'template.result',
          requestId: saveRequest.requestId,
          status: 'accepted',
          templates: [saveRequest.template],
        }),
      ),
    );

    expect(await screen.findByRole('combobox', { name: 'Project template' })).toHaveTextContent(
      '새 템플릿',
    );
  });

  it('템플릿 항목에서 삭제를 선택하고 확인하면 삭제 요청을 보낸다', async () => {
    const socket = renderWithSession();
    const template = {
      id: '00000000-0000-4000-8000-000000000033',
      name: '삭제할 템플릿',
      description: '설명',
      body: '본문',
    };
    provideTemplateList(socket, [template]);
    fireEvent.click(screen.getByRole('combobox', { name: 'Project template' }));
    fireEvent.click(await screen.findByRole('option', { name: /삭제할 템플릿/ }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Project template' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 삭제할 템플릿' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('삭제할 템플릿');

    fireEvent.click(screen.getByRole('button', { name: 'Delete template' }));

    const deleteRequest = JSON.parse(String(socket.send.mock.calls.at(-1)?.[0])) as {
      requestId: string;
      id: string;
    };
    expect(deleteRequest).toMatchObject({ type: 'template.delete', id: template.id });
    act(() =>
      socket.emit(
        'message',
        JSON.stringify({
          type: 'template.result',
          requestId: deleteRequest.requestId,
          status: 'accepted',
          templates: [],
        }),
      ),
    );

    expect(screen.getByText('No project templates yet.')).toBeInTheDocument();
  });

  it('선택하지 않은 템플릿 항목에서 수정을 누르면 해당 템플릿을 편집한다', async () => {
    const socket = renderWithSession();
    provideTemplateList(socket, [
      {
        id: '00000000-0000-4000-8000-000000000034',
        name: '수정할 템플릿',
        description: '기존 설명',
        body: '기존 본문',
      },
    ]);

    fireEvent.click(screen.getByRole('combobox', { name: 'Project template' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit 수정할 템플릿' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Edit template');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('수정할 템플릿');
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('기존 설명');
    expect(screen.getByRole('textbox', { name: 'Markdown body' })).toHaveValue('기존 본문');
  });

  it('편집기가 비어 있으면 선택한 템플릿을 바로 적용한다', async () => {
    const socket = renderWithSession();
    provideTemplateList(socket, [
      {
        id: '00000000-0000-4000-8000-000000000031',
        name: '작업 템플릿',
        description: '짧은 설명',
        body: '# 작업 지시\n\n실행해줘',
      },
    ]);

    fireEvent.click(screen.getByRole('combobox', { name: 'Project template' }));
    fireEvent.click(await screen.findByRole('option', { name: /작업 템플릿/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(crepeTestState.state.instance?.getMarkdown()).toBe('# 작업 지시\n\n실행해줘'),
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('session.handshake'));
  });

  it('기존 편집 내용을 템플릿으로 바꾸기 전에 확인을 요청한다', async () => {
    const socket = renderWithSession('http://127.0.0.1:4321', '현재 명령');
    provideTemplateList(
      socket,
      [
        {
          id: '00000000-0000-4000-8000-000000000032',
          name: '새 명령',
          description: '설명',
          body: '새 본문',
        },
      ],
      '현재 명령',
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'Project template' }));
    fireEvent.click(await screen.findByRole('option', { name: /새 명령/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('새 명령');
    expect(crepeTestState.state.instance?.getMarkdown()).toBe('현재 명령');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(crepeTestState.state.instance?.getMarkdown()).toBe('현재 명령');
  });

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

  it('AI Feedback Mode에서 피드백이 없으면 Send Feedback을 비활성화한다', () => {
    renderWithSession();

    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    expect(screen.getByRole('button', { name: 'Send Feedback' })).toBeDisabled();
  });

  it('인증된 세션 준비 메시지의 Markdown을 편집기 초기값으로 전송한다', async () => {
    const socket = renderWithSession('http://127.0.0.1:4321', '한글\n\n특수문자: &?#');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send to Codex' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));

    expect(socket.send).toHaveBeenLastCalledWith(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000004',
        prompt: '한글\n\n특수문자: &?#',
      }),
    );
    expect(window.location.search).toBe('');
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

    await waitFor(() =>
      expect(screen.getByRole('status', { hidden: true })).toHaveTextContent('Sent'),
    );
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

  it('제출 중 브리지 연결이 종료되면 전송 상태를 해제한다', async () => {
    const socket = renderWithSession();
    await editMarkdown('Submit while connected');
    fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));

    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    socket.emit('close', undefined);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Disconnected'));
    expect(screen.queryByRole('button', { name: 'Sending…' })).not.toBeInTheDocument();
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
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Review this' })).toBeInTheDocument(),
    );
    expect(screen.getByTestId('annotated-markdown')).not.toHaveTextContent('# Review this');
    expect(screen.getByTestId('annotated-markdown')).toHaveClass('markdown-content');
    expect(
      screen
        .getByRole('button', { name: 'Add global feedback' })
        .querySelector('.global-feedback-icon'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByTestId('feedback-markdown-editor').querySelector('.ProseMirror'),
      ).toHaveAttribute('aria-label', 'Markdown feedback document'),
    );
    expect(screen.queryByRole('textbox', { name: 'Command' })).not.toBeInTheDocument();
  });

  it('AI Feedback Mode에서 task list 항목을 비활성 checkbox로 표시한다', async () => {
    renderWithSession();
    await editMarkdown('- [x] Run the tests');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const feedbackEditor = await waitFor(() => {
      const editor = screen.getByTestId('feedback-markdown-editor');
      expect(editor.querySelector('input[type="checkbox"]')).not.toBeNull();
      return editor;
    });

    expect(feedbackEditor.querySelector('input[type="checkbox"]')).toBeDisabled();
    expect(feedbackEditor).toHaveTextContent('Run the tests');
  });

  it('AI Feedback Mode에서 Markdown link를 anchor로 표시한다', async () => {
    renderWithSession();
    await editMarkdown('[Milkdown](https://milkdown.dev)');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const link = await screen.findByRole('link', { name: 'Milkdown' });

    expect(link).toHaveAttribute('href', 'https://milkdown.dev');
  });

  it('AI Feedback Mode에서 fenced code block을 pre 요소로 표시한다', async () => {
    renderWithSession();
    await editMarkdown('```ts\nconst answer = 42;\n```');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const codeBlock = await waitFor(() => {
      const block = screen.getByTestId('feedback-markdown-editor').querySelector('pre');
      expect(block).not.toBeNull();
      return block as HTMLElement;
    });

    expect(codeBlock).toHaveTextContent('const answer = 42;');
  });

  it('AI Feedback Mode에서 table header와 cell을 표 구조로 표시한다', async () => {
    renderWithSession();
    await editMarkdown('| Name | Value |\n| --- | --- |\n| mode | feedback |');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const table = await waitFor(() => {
      const renderedTable = screen.getByTestId('feedback-markdown-editor').querySelector('table');
      expect(renderedTable).not.toBeNull();
      return renderedTable as HTMLTableElement;
    });

    expect(table.querySelectorAll('th')).toHaveLength(2);
    expect(table.querySelectorAll('td')).toHaveLength(2);
    expect(table).toHaveTextContent('feedback');
  });

  it('Feedback Mode에서 여러 table cell을 선택하면 표 전체 feedback composer를 표시한다', async () => {
    renderWithSession();
    const markdown = '| Name | Value |\n| --- | --- |\n| mode | feedback |';
    await editMarkdown(markdown);
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const article = screen.getByTestId('annotated-markdown');
    const table = await waitFor(() => {
      const renderedTable = article.querySelector('.milkdown-table-block');
      expect(renderedTable).not.toBeNull();
      return renderedTable as HTMLElement;
    });
    table.querySelectorAll('td').forEach((cell) => cell.classList.add('selectedCell'));
    fireEvent.mouseDown(article);
    fireEvent.mouseUp(article);

    const composer = await screen.findByRole('textbox', { name: 'Feedback on selection' });

    expect(composer.closest('form')?.querySelector('q')?.textContent).toBe(markdown);
  });

  it('표 CellSelection feedback을 닫은 뒤 문단을 선택하면 문단 feedback composer를 표시한다', async () => {
    renderWithSession();
    const markdown = 'Outside text\n\n| Name | Value |\n| --- | --- |\n| mode | feedback |';
    await editMarkdown(markdown);
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const article = screen.getByTestId('annotated-markdown');
    const table = await waitFor(() => {
      const renderedTable = article.querySelector('.milkdown-table-block');
      expect(renderedTable).not.toBeNull();
      return renderedTable as HTMLElement;
    });
    table.querySelectorAll('td').forEach((cell) => cell.classList.add('selectedCell'));
    fireEvent.mouseDown(article);
    fireEvent.mouseUp(article);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(table.querySelector('.selectedCell')).toBeNull();
    await waitFor(() => expect(hasRenderedSourceMap(article)).toBe(true));

    const outsideTextStart = markdown.indexOf('Outside text');
    selectSourceRange(article, outsideTextStart, outsideTextStart + 'Outside text'.length);

    const composer = await screen.findByRole('textbox', { name: 'Feedback on selection' });
    expect(composer.closest('form')?.querySelector('q')?.textContent).toBe('Outside text');
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

  it('Feedback Mode에서 텍스트를 드래그하면 선택 영역 위에 feedback tooltip을 표시한다', async () => {
    renderWithSession();
    await editMarkdown('# Review this\n\nSecond paragraph');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const article = screen.getByTestId('annotated-markdown');
    await waitFor(() => expect(article.querySelector('h1')?.textContent).toBe('Review this'));
    const textNode = article.querySelector('h1')?.firstChild;
    if (!(textNode instanceof Text)) throw new Error('Rendered heading text was not found.');
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.mouseDown(article);
    fireEvent.mouseUp(article);

    expect(
      await screen.findByRole('textbox', { name: 'Feedback on selection' }),
    ).toBeInTheDocument();
    expect(
      within(article).queryByRole('textbox', { name: 'Feedback on selection' }),
    ).not.toBeInTheDocument();
    expect(within(article).getByText('Review this')).toBeInTheDocument();
  });

  it('키보드로 문서를 선택하면 선택 영역 위에 feedback tooltip을 표시한다', async () => {
    renderWithSession();
    await editMarkdown('Keyboard selection');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const article = screen.getByTestId('annotated-markdown');
    await waitFor(() => expect(article.querySelector('p')?.textContent).toBe('Keyboard selection'));
    const textNode = article.querySelector('p')?.firstChild;
    if (!(textNode instanceof Text)) throw new Error('Rendered paragraph text was not found.');
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    expect(
      await screen.findByRole('textbox', { name: 'Feedback on selection' }),
    ).toBeInTheDocument();
  });

  it('겹치는 선택 영역은 기존 feedback을 열고 확장된 범위로 저장한다', async () => {
    renderWithSession();
    await editMarkdown('Plain text for selection');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const article = screen.getByTestId('annotated-markdown');
    await waitFor(() => expect(hasRenderedSourceMap(article)).toBe(true));
    selectSourceRange(article, 0, 5);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Feedback on selection' }), {
      target: { value: 'Keep this context.' },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Add feedback' }));
    expect(article.querySelector('.markdown-source-span')).toBeNull();

    selectSourceRange(screen.getByTestId('annotated-markdown'), 3, 8);
    const composer = await screen.findByRole('textbox', { name: 'Feedback on selection' });
    expect(composer).toHaveValue('Keep this context.');
    expect(screen.getByRole('button', { name: 'Send Feedback (1)' })).toBeInTheDocument();

    fireEvent.change(composer, { target: { value: 'Use the expanded context.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));

    expect(screen.getByRole('complementary', { name: 'Feedback list' })).toHaveTextContent(
      'Use the expanded context.',
    );
    expect(screen.getByRole('button', { name: 'Send Feedback (1)' })).toBeInTheDocument();
  });

  it('Feedback Mode에서 list 항목을 선택해 저장하면 Selected text 상태를 표시한다', async () => {
    renderWithSession();
    const markdown = '- Bullet item';
    await editMarkdown(markdown);
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const article = screen.getByTestId('annotated-markdown');
    await waitFor(() => expect(hasRenderedSourceMap(article)).toBe(true));
    const start = markdown.indexOf('Bullet item');
    selectSourceRange(article, start, start + 'Bullet item'.length);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Feedback on selection' }), {
      target: { value: 'Review the list item.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));

    const panel = screen.getByRole('complementary', { name: 'Feedback list' });
    expect(panel).toHaveTextContent('Selected text');
    expect(panel).not.toHaveTextContent('Invalid selection');
  });

  it('Feedback Mode에서 ordered list 항목을 선택해 저장하면 Selected text 상태를 표시한다', async () => {
    renderWithSession();
    const markdown = '1. Number item';
    await editMarkdown(markdown);
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const article = screen.getByTestId('annotated-markdown');
    await waitFor(() => expect(hasRenderedSourceMap(article)).toBe(true));
    const start = markdown.indexOf('Number item');
    selectSourceRange(article, start, start + 'Number item'.length);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Feedback on selection' }), {
      target: { value: 'Review the numbered item.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));

    const panel = screen.getByRole('complementary', { name: 'Feedback list' });
    expect(panel).toHaveTextContent('Selected text');
    expect(panel).not.toHaveTextContent('Invalid selection');
  });

  it('Feedback Mode에서 task list 항목을 선택해 저장하면 Selected text 상태를 표시한다', async () => {
    renderWithSession();
    const markdown = '- [x] Check item';
    await editMarkdown(markdown);
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const article = screen.getByTestId('annotated-markdown');
    await waitFor(() => expect(hasRenderedSourceMap(article)).toBe(true));
    const start = markdown.indexOf('Check item');
    selectSourceRange(article, start, start + 'Check item'.length);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Feedback on selection' }), {
      target: { value: 'Review the checklist item.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));

    const panel = screen.getByRole('complementary', { name: 'Feedback list' });
    expect(panel).toHaveTextContent('Selected text');
    expect(panel).not.toHaveTextContent('Invalid selection');
  });

  it('Feedback Mode에서 code block을 선택해 저장하면 Selected text 상태를 표시한다', async () => {
    renderWithSession();
    const markdown = '```ts\nconst answer = 42;\n```';
    await editMarkdown(markdown);
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const article = screen.getByTestId('annotated-markdown');
    const start = markdown.indexOf('answer');
    await waitFor(() => expect(article.querySelector('[data-code-source-start]')).not.toBeNull());
    selectCodeSourceRange(article, start, start + 'answer'.length);
    expect(within(await screen.findByRole('dialog')).getByText('const answer = 42;')).toBeVisible();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Feedback on selection' }), {
      target: { value: 'Review the implementation.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));

    const panel = screen.getByRole('complementary', { name: 'Feedback list' });
    expect(panel).toHaveTextContent('Selected text');
    expect(panel).not.toHaveTextContent('Invalid selection');
    await waitFor(() => expect(article.querySelector('.feedback-code-highlight')).not.toBeNull());
  });

  it('Feedback Mode에서 code block feedback을 제출하면 선택 composer를 닫는다', async () => {
    renderWithSession();
    const markdown = '```ts\nconst answer = 42;\n```';
    await editMarkdown(markdown);
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const article = screen.getByTestId('annotated-markdown');
    const start = markdown.indexOf('const answer');
    await waitFor(() => expect(article.querySelector('[data-code-source-start]')).not.toBeNull());
    selectCodeSourceRange(article, start, start + 'const answer = 42;'.length);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Feedback on selection' }), {
      target: { value: 'Keep this code.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'Feedback on selection' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('Feedback Mode에서 list feedback을 제출한 뒤 다른 텍스트를 선택하면 새 composer를 표시한다', async () => {
    renderWithSession();
    const markdown = '- First item\n\nSecond paragraph';
    await editMarkdown(markdown);
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const article = screen.getByTestId('annotated-markdown');
    await waitFor(() => expect(hasRenderedSourceMap(article)).toBe(true));
    const firstStart = markdown.indexOf('First item');
    selectSourceRange(article, firstStart, firstStart + 'First item'.length);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Feedback on selection' }), {
      target: { value: 'Review the first item.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'Feedback on selection' }),
      ).not.toBeInTheDocument(),
    );

    const secondStart = markdown.indexOf('Second paragraph');
    selectSourceRange(article, secondStart, secondStart + 'Second paragraph'.length);

    expect(
      await screen.findByRole('textbox', { name: 'Feedback on selection' }),
    ).toBeInTheDocument();
  });

  it('드래그 종료가 문서 바깥에서 발생해도 취소 후 다른 영역을 다시 선택할 수 있다', async () => {
    renderWithSession();
    const markdown = 'First feedback area\n\nSecond feedback area';
    await editMarkdown(markdown);
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));

    const article = screen.getByTestId('annotated-markdown');
    await waitFor(() => expect(hasRenderedSourceMap(article)).toBe(true));
    const firstStart = markdown.indexOf('First feedback');
    selectSourceRange(article, firstStart, firstStart + 'First feedback'.length);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Feedback on selection' }), {
      target: { value: 'Review the first area.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'Feedback on selection' }),
      ).not.toBeInTheDocument(),
    );

    const secondStart = markdown.indexOf('Second feedback');
    setSourceRange(article, secondStart, secondStart + 'Second feedback'.length);
    fireEvent.mouseDown(article);
    fireEvent.mouseUp(document.body);
    expect(
      await screen.findByRole('textbox', { name: 'Feedback on selection' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    setSourceRange(article, firstStart, firstStart + 'First feedback'.length);
    fireEvent.mouseDown(article);
    fireEvent.mouseUp(document.body);
    expect(
      await screen.findByRole('textbox', { name: 'Feedback on selection' }),
    ).toBeInTheDocument();
  });

  it('feedback을 전송하면 3초 뒤 현재 창을 닫는다', async () => {
    const socket = renderWithSession();
    await editMarkdown('# Review this');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add global feedback' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Global feedback' }), {
      target: { value: 'Use a stronger title.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
    const openSpy = vi.spyOn(window, 'open');
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Send Feedback (1)' }));
    expect(socket.send).toHaveBeenLastCalledWith(expect.stringContaining('"mode":"feedback"'));
    vi.useFakeTimers();
    await act(async () => {
      socket.emit(
        'message',
        JSON.stringify({
          type: 'prompt.result',
          submissionId: '00000000-0000-4000-8000-000000000004',
          status: 'accepted',
          prompt: '# Updated by Codex',
        }),
      );
    });

    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent('3초 후 이 창이 닫힙니다.');
    expect(openSpy).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(closeSpy).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it('feedback loop에서 Send Feedback을 누르면 피드백과 전체 Markdown을 Codex에 보낸다', async () => {
    const socket = renderWithSession('http://127.0.0.1:4321', '# Revised draft', true);
    await editMarkdown('# Final draft');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add global feedback' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Global feedback' }), {
      target: { value: 'Keep the key details.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));

    fireEvent.click(screen.getByRole('button', { name: 'Send Feedback (1)' }));

    expect(socket.send).toHaveBeenLastCalledWith(expect.stringContaining('"mode":"feedback"'));
    expect(socket.send).toHaveBeenLastCalledWith(expect.stringContaining('Keep the key details.'));
    expect(socket.send).toHaveBeenLastCalledWith(expect.stringContaining('# Final draft'));
  });

  it('feedback loop에서 Submit을 누르면 검토를 끝내고 현재 Markdown을 최종 제출한다', async () => {
    const socket = renderWithSession('http://127.0.0.1:4321', '# Revised draft', true);
    await editMarkdown('# Final draft');
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add global feedback' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Global feedback' }), {
      target: { value: 'Save this for later.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));

    expect(screen.getByRole('button', { name: 'Send Feedback (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(socket.send).toHaveBeenLastCalledWith(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000004',
        prompt: '# Final draft',
        mode: 'finish',
      }),
    );
  });

  it('빈 문서를 feedback loop에서 제출하면 확인을 요청한 뒤 빈 최종본을 보낸다', async () => {
    const socket = renderWithSession('http://127.0.0.1:4321', '', true);

    fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Submit an empty document?');
    expect(socket.send).not.toHaveBeenCalledWith(expect.stringContaining('"mode":"finish"'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit empty document' }));

    expect(socket.send).toHaveBeenLastCalledWith(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000004',
        prompt: '',
        mode: 'finish',
      }),
    );
  });

  it('12,000자를 넘는 최종 문서는 전송하지 않고 길이 오류를 표시한다', async () => {
    const socket = renderWithSession('http://127.0.0.1:4321', '# Revised draft', true);
    await editMarkdown('x'.repeat(12_001));

    fireEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));

    expect(screen.getByRole('alert')).toHaveTextContent('12,000 characters or fewer');
    expect(socket.send).not.toHaveBeenCalledWith(expect.stringContaining('"mode":"finish"'));
  });

  it('직렬화된 feedback이 12,000자를 넘으면 전송하지 않고 길이 오류를 표시한다', async () => {
    const socket = renderWithSession();
    await editMarkdown('x'.repeat(11_990));
    fireEvent.click(screen.getByRole('tab', { name: 'AI Feedback Mode' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add global feedback' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Global feedback' }), {
      target: { value: 'Clarify this document.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }));

    fireEvent.click(screen.getByRole('button', { name: 'Send Feedback (1)' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Feedback must be 12,000 characters or fewer',
    );
    expect(socket.send).not.toHaveBeenCalledWith(expect.stringContaining('"mode":"feedback"'));
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
