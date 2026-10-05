import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LazyMarkdownEditor } from './LazyMarkdownEditor.js';
import { MarkdownEditor } from './MarkdownEditor.js';
import type { MarkdownEditorProps } from './MarkdownEditor.js';

const crepeTest = vi.hoisted(() => {
  const state: { instance: unknown; uploadConfig: Record<string, unknown> | undefined } = {
    instance: undefined,
    uploadConfig: undefined,
  };
  class MockCrepe {
    public static readonly Feature = {
      ImageBlock: 'image-block',
      Placeholder: 'placeholder',
      BlockEdit: 'block-edit',
    } as const;
    public readonly options: Record<string, unknown>;
    public readonly destroy = vi.fn(async () => undefined);
    public readonly editor = {
      action: vi.fn(),
      config: vi.fn(
        (
          configure: (ctx: {
            update: (
              key: unknown,
              updater: (previous: Record<string, unknown>) => Record<string, unknown>,
            ) => void;
          }) => void,
        ) => {
          configure({
            update: (_key, updater) => {
              state.uploadConfig = updater({});
            },
          });
        },
      ),
    };
    private readOnly = false;
    private editorElement: HTMLElement | undefined;
    public constructor(options: Record<string, unknown>) {
      this.options = options;
      state.instance = this;
    }
    public setReadonly(value: boolean): this {
      this.readOnly = value;
      this.editorElement?.setAttribute('contenteditable', String(!value));
      return this;
    }
    public on(
      configure: (listener: {
        markdownUpdated: (
          callback: (ctx: unknown, markdown: string, previousMarkdown: string) => void,
        ) => void;
        selectionUpdated: (callback: () => void) => void;
      }) => void,
    ): this {
      configure({
        markdownUpdated: () => undefined,
        selectionUpdated: (callback) => {
          this.selectionUpdated = callback;
        },
      });
      return this;
    }
    public async create(): Promise<this> {
      const root = this.options['root'];
      if (!(root instanceof HTMLElement)) throw new Error('Missing editor root');
      this.editorElement = document.createElement('div');
      this.editorElement.className = 'ProseMirror';
      this.editorElement.setAttribute('role', 'textbox');
      this.editorElement.setAttribute('aria-label', 'Command');
      this.editorElement.setAttribute('contenteditable', String(!this.readOnly));
      root.append(this.editorElement);
      return this;
    }
    public getMarkdown(): string {
      return '';
    }
    public emitSelectionUpdated(): void {
      this.selectionUpdated?.();
    }
    private selectionUpdated: (() => void) | undefined;
  }
  return { state, MockCrepe };
});

vi.mock('@milkdown/crepe', () => ({ Crepe: crepeTest.MockCrepe }));

afterEach(() => {
  cleanup();
  crepeTest.state.instance = undefined;
  crepeTest.state.uploadConfig = undefined;
  vi.restoreAllMocks();
});

async function getBlockEditMenuLabels(
  props: Pick<MarkdownEditorProps, 'onDraw'> = {},
): Promise<string[]> {
  render(<MarkdownEditor {...props} />);
  await waitFor(() => expect(crepeTest.state.instance).toBeDefined());
  const instance = crepeTest.state.instance as InstanceType<typeof crepeTest.MockCrepe>;
  const featureConfigs = instance.options['featureConfigs'] as Record<
    string,
    {
      buildMenu: (builder: {
        getGroup: (name: string) => { addItem: (id: string, item: { label: string }) => void };
      }) => void;
    }
  >;
  const labels: string[] = [];

  featureConfigs['block-edit']?.buildMenu({
    getGroup: () => ({
      addItem: (_id, item) => labels.push(item.label),
    }),
  });

  return labels;
}

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

  it('Milkdown 업로더를 앱 첨부 업로드 콜백에 연결한다', async () => {
    const uploadedImage = { src: '.complex-prompt/attachments/saved.png', alt: 'paste.png' };
    const onUploadImageFiles = vi.fn().mockResolvedValue([uploadedImage]);
    render(<MarkdownEditor onUploadImageFiles={onUploadImageFiles} />);
    await screen.findByRole('textbox', { name: 'Command' });
    const uploader = crepeTest.state.uploadConfig?.['uploader'] as (
      files: FileList,
      schema: {
        nodes: {
          image: { createAndFill: (attrs: Record<string, string>) => unknown };
          paragraph: { create: (attrs: null, content: unknown) => unknown };
        };
      },
    ) => Promise<readonly unknown[]>;
    const getInsertPos = crepeTest.state.uploadConfig?.['getInsertPos'] as (
      event: unknown,
      context: {
        get: (key: unknown) => {
          readonly state: { readonly doc: { readonly content: { readonly size: number } } };
        };
      },
      defaultPosition: number,
    ) => number;
    const image = new File(['image'], 'paste.png', { type: 'image/png' });
    const files = Object.assign([image], { item: (index: number) => [image][index] ?? null });
    const schema = {
      nodes: {
        image: { createAndFill: vi.fn((attrs: Record<string, string>) => ({ attrs })) },
        paragraph: { create: vi.fn((_attrs: null, content: unknown) => ({ content })) },
      },
    };

    const nodes = await uploader(files as unknown as FileList, schema);
    const insertionPosition = getInsertPos(
      new Event('paste'),
      {
        get: () => ({ state: { doc: { content: { size: 42 } } } }),
      },
      3,
    );

    expect(crepeTest.state.uploadConfig?.['enableHtmlFileUploader']).toBe(true);
    expect(insertionPosition).toBe(42);
    expect(onUploadImageFiles).toHaveBeenCalledExactlyOnceWith([image]);
    expect(nodes).toEqual([{ content: { attrs: uploadedImage } }]);
    expect(schema.nodes.paragraph.create).toHaveBeenCalledOnce();
  });

  it('Milkdown 선택 변경을 피드백 선택 콜백으로 전달한다', async () => {
    const onSelectionUpdated = vi.fn();
    render(<MarkdownEditor onSelectionUpdated={onSelectionUpdated} />);
    await screen.findByRole('textbox', { name: 'Command' });
    const instance = crepeTest.state.instance as InstanceType<typeof crepeTest.MockCrepe>;

    act(() => instance.emitSelectionUpdated());

    expect(onSelectionUpdated).toHaveBeenCalledOnce();
  });

  it('아직 열지 않은 빈 편집기에 이미지를 드롭하면 이미지 처리 콜백에 전달한다', () => {
    const onImageFiles = vi.fn();
    render(<LazyMarkdownEditor onImageFiles={onImageFiles} />);
    const fallback = screen.getByRole('button', { name: 'Markdown command editor' });
    const image = new File(['image'], 'initial-drop.png', { type: 'image/png' });

    fireEvent.drop(fallback, { dataTransfer: { files: [image] } });

    expect(onImageFiles).toHaveBeenCalledExactlyOnceWith([image]);
  });

  it('MIME 형식이 비어 있는 드롭 파일을 이미지 검사 콜백에 전달한다', () => {
    const onImageFiles = vi.fn();
    render(<LazyMarkdownEditor onImageFiles={onImageFiles} />);
    const fallback = screen.getByRole('button', { name: 'Markdown command editor' });
    const image = new File(['image'], 'initial-drop.png');

    fireEvent.drop(fallback, { dataTransfer: { files: [image] } });

    expect(image.type).toBe('');
    expect(onImageFiles).toHaveBeenCalledExactlyOnceWith([image]);
  });

  it('언마운트하면 에디터 인스턴스를 정리한다', async () => {
    const { unmount } = render(<MarkdownEditor />);
    await screen.findByRole('textbox', { name: 'Command' });
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

  it('Draw 액션이 있으면 BlockEdit 메뉴에 Draw를 추가한다', async () => {
    const labels = await getBlockEditMenuLabels({ onDraw: vi.fn() });

    expect(labels).toContain('Draw');
  });

  it('BlockEdit 메뉴에 Diagram을 추가한다', async () => {
    const labels = await getBlockEditMenuLabels();

    expect(labels).toContain('Diagram');
  });

  it('그림 옆 삭제 버튼이 해당 첨부 파일을 삭제한다', async () => {
    const onDeleteDrawing = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({ 'X-Attachment-Editable': 'true' }),
    } as Response);
    render(
      <MarkdownEditor
        attachmentUrl="http://127.0.0.1:8765/_complex-prompt/attachments"
        attachmentToken="test-token"
        onEditDrawing={vi.fn()}
        onDeleteDrawing={onDeleteDrawing}
      />,
    );
    const editor = await screen.findByRole('textbox', { name: 'Command' });
    const image = document.createElement('img');
    image.src = '.complex-prompt/attachments/00000000-0000-4000-8000-000000000009.png';
    editor.append(image);

    fireEvent.pointerMove(image);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete drawing' }));

    expect(onDeleteDrawing).toHaveBeenCalledExactlyOnceWith('00000000-0000-4000-8000-000000000009');
  });
});
