import { useCallback, type RefObject } from 'react';
import type { Crepe } from '@milkdown/crepe';
import { editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import { NodeSelection } from '@milkdown/kit/prose/state';
import { insertMermaidDiagram as insertMermaidBlock } from '@codex-complex-prompt/milkdown-plugins/mermaid/core';

export function useMarkdownEditorMenuCommands(crepeRef: RefObject<Crepe | null>) {
  const insertMermaidDiagram = useCallback(
    function insertMermaidDiagram(): void {
      const crepe = crepeRef.current;
      if (crepe !== null) insertMermaidBlock(crepe);
    },
    [crepeRef],
  );

  const insertMediaPlaceholder = useCallback(
    function insertMediaPlaceholder(): void {
      const editor = crepeRef.current?.editor;
      if (editor === undefined) return;
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const image = ctx.get(schemaCtx).nodes['image'];
        const paragraph = ctx.get(schemaCtx).nodes['paragraph'];
        if (image === undefined || paragraph === undefined) return;
        const blankImage = image.create({ src: '', alt: '' });
        const imageParagraph = paragraph.create(null, blankImage);
        let transaction = view.state.tr.replaceSelectionWith(imageParagraph).scrollIntoView();
        const selection = transaction.selection.$from;
        if (selection.depth > 0) {
          const imagePosition = selection.before(selection.depth) + 1;
          if (transaction.doc.nodeAt(imagePosition)?.type.name === 'image') {
            transaction = transaction.setSelection(
              NodeSelection.create(transaction.doc, imagePosition),
            );
          }
        }
        view.dispatch(transaction);
      });
    },
    [crepeRef],
  );

  return { insertMermaidDiagram, insertMediaPlaceholder };
}
