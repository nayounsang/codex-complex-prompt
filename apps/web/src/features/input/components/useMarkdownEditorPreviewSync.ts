import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { editorViewCtx } from '@milkdown/kit/core';
import {
  createMermaidPreviewTargets,
  haveSameMermaidPreviewTargets,
} from '@codex-complex-prompt/milkdown-plugins/mermaid/core';
import {
  haveSameMediaEmbedTargets,
  updateMediaEmbedTargets,
  type MediaEmbedTarget,
} from '../../../shared/markdown/media-embeds.js';
import type { MermaidDiagramTarget } from '@codex-complex-prompt/milkdown-plugins/mermaid/core';
import type { Crepe } from '@milkdown/crepe';

interface MarkdownEditorPreviewSyncOptions {
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly crepeRef: RefObject<Crepe | null>;
  readonly setMermaidTargets: Dispatch<SetStateAction<MermaidDiagramTarget[]>>;
  readonly setMediaTargets: Dispatch<SetStateAction<MediaEmbedTarget[]>>;
}

export function useMarkdownEditorPreviewSync({
  rootRef,
  crepeRef,
  setMermaidTargets,
  setMediaTargets,
}: MarkdownEditorPreviewSyncOptions) {
  const syncMermaidPreviews = useCallback(
    function syncMermaidPreviews(editorRoot: HTMLDivElement, recoverRemovedPreview = false): void {
      const editor = crepeRef.current?.editor;
      if (editor === undefined) return;
      const contents: Array<{
        readonly language: string;
        readonly source: string;
        readonly position: number;
      }> = [];
      editor.action((ctx) => {
        ctx.get(editorViewCtx).state.doc.descendants((node, position) => {
          if (node.type.name === 'code_block') {
            contents.push({
              language: String(node.attrs['language'] ?? '').toLowerCase(),
              source: node.textContent,
              position,
            });
          }
        });
      });
      const blockElements = editorRoot.querySelectorAll<HTMLElement>('.milkdown-code-block');
      if (recoverRemovedPreview) {
        blockElements.forEach((block) => {
          const mount = block.querySelector<HTMLDivElement>(':scope > .mermaid-preview-mount');
          if (mount?.childElementCount === 0) mount.remove();
        });
      }
      const targets = createMermaidPreviewTargets(contents, Array.from(blockElements));
      setMermaidTargets((current) =>
        haveSameMermaidPreviewTargets(current, targets) ? current : targets,
      );
    },
    [crepeRef, setMermaidTargets],
  );

  const syncMediaEmbeds = useCallback(
    function syncMediaEmbeds(
      editorRoot: HTMLDivElement,
      containers?: readonly HTMLElement[],
    ): void {
      const mountRoot =
        editorRoot.querySelector<HTMLElement>('.milkdown') ?? rootRef.current ?? editorRoot;
      setMediaTargets((current) => {
        const next = updateMediaEmbedTargets(editorRoot, current, mountRoot, containers);
        return haveSameMediaEmbedTargets(current, next) ? current : next;
      });
    },
    [rootRef, setMediaTargets],
  );

  return { syncMermaidPreviews, syncMediaEmbeds };
}
