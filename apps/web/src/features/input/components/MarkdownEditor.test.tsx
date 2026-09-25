import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownEditor } from './MarkdownEditor.js';

const crepeTest = vi.hoisted(() => {
  const state: { instance: unknown } = { instance: undefined };
  class MockCrepe {
    public static readonly Feature = {
      ImageBlock: 'image-block',
      Placeholder: 'placeholder',
      BlockEdit: 'block-edit',
    } as const;
    public readonly options: Record<string, unknown>;
    public readonly destroy = vi.fn(async () => undefined);
    private readOnly = false;
    private editor: HTMLElement | undefined;
    public constructor(options: Record<string, unknown>) {
      this.options = options;
      state.instance = this;
    }
    public setReadonly(value: boolean): this {
      this.readOnly = value;
      this.editor?.setAttribute('contenteditable', String(!value));
      return this;
    }
    public on(): this {
      return this;
    }
    public async create(): Promise<this> {
      const root = this.options['root'];
      if (!(root instanceof HTMLElement)) throw new Error('Missing editor root');
      this.editor = document.createElement('div');
      this.editor.className = 'ProseMirror';
      this.editor.setAttribute('role', 'textbox');
      this.editor.setAttribute('aria-label', 'Command');
      this.editor.setAttribute('contenteditable', String(!this.readOnly));
      root.append(this.editor);
      return this;
    }
    public getMarkdown(): string {
      return '';
    }
  }
  return { state, MockCrepe };
});

vi.mock('@milkdown/crepe', () => ({ Crepe: crepeTest.MockCrepe }));

afterEach(() => {
  cleanup();
  crepeTest.state.instance = undefined;
  vi.restoreAllMocks();
});

describe('MarkdownEditor', () => {
  it('Crepe에 파일 이미지 기능을 끄고 기본 Markdown을 전달한다', async () => {
    render(<MarkdownEditor defaultMarkdown="# Draft" />);
    await waitFor(() => expect(crepeTest.state.instance).toBeDefined());
    const instance = crepeTest.state.instance as InstanceType<typeof crepeTest.MockCrepe>;

    expect(instance.options).toMatchObject({
      defaultValue: '# Draft',
      features: { 'image-block': false },
    });
  });

  it('이미지 파일 붙여넣기를 막고 언마운트 때 에디터를 정리한다', async () => {
    const { unmount } = render(<MarkdownEditor />);
    const editor = await screen.findByRole('textbox', { name: 'Command' });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [new File(['image'], 'image.png', { type: 'image/png' })] },
    });

    editor.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    const instance = crepeTest.state.instance as InstanceType<typeof crepeTest.MockCrepe>;
    unmount();
    expect(instance.destroy).toHaveBeenCalledOnce();
  });

  it('readOnly 속성을 Crepe 편집기에도 반영한다', async () => {
    render(<MarkdownEditor readOnly />);
    expect(await screen.findByRole('textbox', { name: 'Command' })).toHaveAttribute(
      'contenteditable',
      'false',
    );
  });
});
