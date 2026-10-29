import type { Crepe } from '@milkdown/crepe';
import { editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import { z } from 'zod';
import type { MermaidPreviewTarget } from './preview-targets.js';
import { MERMAID_UI_REPLACEMENT_MODEL } from '../shared.js';

const mermaidCodeBlockSchema = z.object({
  type: z.object({ name: z.literal('code_block') }),
  attrs: z
    .object({
      language: z
        .string()
        .transform((language) => language.toLowerCase())
        .pipe(z.literal(MERMAID_UI_REPLACEMENT_MODEL.language)),
    })
    .passthrough(),
  textContent: z.string(),
  nodeSize: z.number(),
});

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
    const nodeResult = mermaidCodeBlockSchema.safeParse(view.state.doc.nodeAt(position));
    if (!nodeResult.success || nodeResult.data.textContent !== originalSource) return;
    const { attrs, nodeSize } = nodeResult.data;
    const content = source === undefined || source === '' ? undefined : schema.text(source);
    const replacement =
      source === undefined
        ? schema.nodes['paragraph']?.create()
        : schema.nodes['code_block']?.create(
            { ...attrs, language: MERMAID_UI_REPLACEMENT_MODEL.language },
            content,
          );
    if (replacement === undefined) return;
    view.dispatch(view.state.tr.replaceWith(position, position + nodeSize, replacement));
    view.focus();
    replaced = true;
  });
  return replaced;
}
