import type { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import { describe, expect, it, vi } from 'vitest';
import { replaceMermaidBlock } from './editor-commands.js';
import type { MermaidPreviewTarget } from './preview-targets.js';

function createCrepe(node: unknown) {
  const replacement = {};
  const transaction = { replaceWith: vi.fn().mockReturnThis() };
  const view = {
    state: { doc: { nodeAt: vi.fn(() => node) }, tr: transaction },
    dispatch: vi.fn(),
    focus: vi.fn(),
  };
  const schema = {
    nodes: {
      paragraph: { create: vi.fn(() => replacement) },
      code_block: { create: vi.fn(() => replacement) },
    },
    text: vi.fn((source: string) => source),
  };
  const context = {
    get: vi.fn((key: unknown) => (key === editorViewCtx ? view : schema)),
  };
  const crepe = {
    editor: { action: vi.fn((callback: (ctx: typeof context) => void) => callback(context)) },
  } as unknown as Crepe;

  return { crepe, replacement, schema, transaction, view };
}

function createTarget(source: string): MermaidPreviewTarget {
  return {
    id: 'mermaid-preview-1',
    block: {} as HTMLElement,
    mount: {} as HTMLDivElement,
    source,
    position: 0,
  };
}

describe('replaceMermaidBlock', () => {
  it('replaces a current Mermaid block and normalizes the language', () => {
    const node = {
      type: { name: 'code_block' },
      attrs: { language: 'MERMAID' },
      textContent: 'flowchart TD',
      nodeSize: 14,
    };
    const { crepe, replacement, schema, transaction, view } = createCrepe(node);

    expect(replaceMermaidBlock(crepe, createTarget('flowchart TD'), '')).toBe(true);
    expect(schema.nodes.code_block.create).toHaveBeenCalledWith({ language: 'mermaid' }, undefined);
    expect(transaction.replaceWith).toHaveBeenCalledWith(0, 14, replacement);
    expect(view.dispatch).toHaveBeenCalledOnce();
  });

  it('does not replace a block whose source changed after preview', () => {
    const { crepe, view } = createCrepe({
      type: { name: 'code_block' },
      attrs: { language: 'mermaid' },
      textContent: 'new source',
      nodeSize: 12,
    });

    expect(replaceMermaidBlock(crepe, createTarget('old source'), 'replacement')).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it('does not replace a code block with another language', () => {
    const { crepe, view } = createCrepe({
      type: { name: 'code_block' },
      attrs: { language: 'typescript' },
      textContent: 'flowchart TD',
      nodeSize: 14,
    });

    expect(replaceMermaidBlock(crepe, createTarget('flowchart TD'), 'replacement')).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it('does not replace a different node type with the same source', () => {
    const { crepe, view } = createCrepe({
      type: { name: 'paragraph' },
      attrs: { language: 'mermaid' },
      textContent: 'flowchart TD',
      nodeSize: 14,
    });

    expect(replaceMermaidBlock(crepe, createTarget('flowchart TD'), 'replacement')).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });

  it('rejects a missing node through the schema', () => {
    const { crepe, view } = createCrepe(null);

    expect(replaceMermaidBlock(crepe, createTarget(''), 'replacement')).toBe(false);
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});
