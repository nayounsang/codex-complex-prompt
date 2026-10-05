import { vi } from 'vitest';

const mockCrepe = vi.hoisted(() => {
  interface MockUploadConfig {
    readonly uploader?: (
      files: FileList,
      schema: {
        readonly nodes: {
          readonly image: { createAndFill: (attrs: Record<string, string>) => unknown };
          readonly paragraph: { create: (attrs: null, content: unknown) => unknown };
        };
      },
    ) => Promise<readonly unknown[]>;
  }

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
      const image = markdown.slice(cursor).match(/^!\[([^\]]*)\]\(([^)]+)\)/);
      if (image !== null) {
        const imageElement = document.createElement('img');
        imageElement.alt = image[1] ?? '';
        imageElement.src = image[2] ?? '';
        root.append(imageElement);
        cursor += image[0].length;
        continue;
      }
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
    public readonly destroy = vi.fn(() => Promise.resolve());
    private markdown: string;
    private readOnly = false;
    private markdownUpdated:
      ((ctx: unknown, markdown: string, previousMarkdown: string) => void) | undefined;
    private selectionUpdated: (() => void) | undefined;
    private editorElement: HTMLElement | undefined;
    private uploadConfig: MockUploadConfig = {};
    public readonly editor = {
      action: vi.fn(),
      config: (
        configure: (ctx: {
          update: (key: unknown, updater: (previous: MockUploadConfig) => MockUploadConfig) => void;
        }) => void,
      ): void => {
        configure({
          update: (_key, updater) => {
            this.uploadConfig = updater(this.uploadConfig);
          },
        });
      },
    };

    public constructor(options: Record<string, unknown>) {
      this.options = options;
      const defaultValue = options['defaultValue'];
      this.markdown = typeof defaultValue === 'string' ? defaultValue : '';
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
        selectionUpdated: (callback: () => void) => void;
      }): void;
    }): this {
      configure({
        markdownUpdated: (callback) => {
          this.markdownUpdated = callback;
        },
        selectionUpdated: (callback) => {
          this.selectionUpdated = callback;
        },
      });
      return this;
    }

    public emitSelectionUpdated(): void {
      this.selectionUpdated?.();
    }

    public create(): Promise<this> {
      if (state.createError !== undefined) return Promise.reject(state.createError);
      const root = this.options['root'];
      if (!(root instanceof HTMLElement)) {
        return Promise.reject(new Error('Crepe root was not provided.'));
      }
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
      const uploadFiles = (event: ClipboardEvent | DragEvent): void => {
        const transfer = 'clipboardData' in event ? event.clipboardData : event.dataTransfer;
        const files = transfer === null ? [] : Array.from(transfer.files);
        if (files.length === 0 || this.uploadConfig.uploader === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        void this.uploadImages(files);
      };
      editor.addEventListener('paste', uploadFiles);
      editor.addEventListener('drop', uploadFiles);
      root.append(editor);
      this.editorElement = editor;
      return Promise.resolve(this);
    }

    private async uploadImages(files: readonly File[]): Promise<void> {
      const uploader = this.uploadConfig.uploader;
      const root = this.editorElement;
      if (uploader === undefined || root === undefined) return;
      const fileList = Object.assign([...files], {
        item: (index: number) => files[index] ?? null,
      }) as unknown as FileList;
      const schema = {
        nodes: {
          image: { createAndFill: (attrs: Record<string, string>) => ({ attrs }) },
          paragraph: { create: (_attrs: null, content: unknown) => ({ content }) },
        },
      };
      const paragraphs = await uploader(fileList, schema);
      const markdownImages = paragraphs.map((paragraph) => {
        const image = (
          paragraph as { readonly content?: { readonly attrs?: Record<string, string> } }
        ).content;
        return `![${image?.attrs?.['alt'] ?? ''}](${image?.attrs?.['src'] ?? ''})`;
      });
      const previousMarkdown = this.markdown;
      this.markdown = `${previousMarkdown.trimEnd()}${previousMarkdown.trim() === '' ? '' : '\n\n'}${markdownImages.join('\n\n')}`;
      renderMockMarkdown(root, this.markdown);
      this.markdownUpdated?.({}, this.markdown, previousMarkdown);
    }

    public getMarkdown(): string {
      return this.markdown;
    }
  }

  return { MockCrepe, state };
});

export const crepeTestState = { state: mockCrepe.state };

vi.mock('@milkdown/crepe', () => ({ Crepe: mockCrepe.MockCrepe }));
