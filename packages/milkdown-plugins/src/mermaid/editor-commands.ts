import type { Crepe } from '@milkdown/crepe';
import { editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import type { MermaidPreviewTarget } from './preview-targets.js';
import { MERMAID_UI_REPLACEMENT_MODEL } from '../shared.js';

export function insertMermaidDiagram(crepe: Crepe): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const codeBlock = ctx.get(schemaCtx).nodes['code_block'];
    if (codeBlock === undefined) return;
    view.dispatch(
      view.state.tr.replaceSelectionWith(
        codeBlock.create({ language: MERMAID_UI_REPLACEMENT_MODEL.language }),
      ),
    );
    view.focus();
  });
}

export function replaceMermaidBlock(
  crepe: Crepe,
  target: MermaidPreviewTarget,
  source?: string,
): boolean {
  let replaced = false;
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const schema = ctx.get(schemaCtx);
    const { position, source: originalSource } = target;
    const node = view.state.doc.nodeAt(position);
    if (
      node === null ||
      node.type.name !== 'code_block' ||
      String(node.attrs['language']).toLowerCase() !== MERMAID_UI_REPLACEMENT_MODEL.language ||
      node.textContent !== originalSource
    )
      return;
    const replacement =
      source === undefined
        ? schema.nodes['paragraph']?.create()
        : schema.nodes['code_block']?.create(
            { ...node.attrs, language: MERMAID_UI_REPLACEMENT_MODEL.language },
            source === '' ? undefined : schema.text(source),
          );
    if (replacement === undefined) return;
    view.dispatch(view.state.tr.replaceWith(position, position + node.nodeSize, replacement));
    view.focus();
    replaced = true;
  });
  return replaced;
}
