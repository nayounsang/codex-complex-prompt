import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { editorViewCtx } from '@milkdown/kit/core';
import {
  createMermaidPreviewTargets,
  haveSameMermaidPreviewTargets,
} from './mermaid-preview-targets.js';
import {
  haveSameVideoEmbedTargets,
  updateVideoEmbedTargets,
  type VideoEmbedTarget,
} from '../../../shared/markdown/video-embeds.js';
import type { MermaidDiagramTarget } from './MermaidDiagramCard.js';
import type { Crepe } from '@milkdown/crepe';

interface MarkdownEditorPreviewSyncOptions {
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly crepeRef: RefObject<Crepe | null>;
  readonly setMermaidTargets: Dispatch<SetStateAction<MermaidDiagramTarget[]>>;
  readonly setVideoTargets: Dispatch<SetStateAction<VideoEmbedTarget[]>>;
}

export function useMarkdownEditorPreviewSync({
  rootRef,
  crepeRef,
  setMermaidTargets,
  setVideoTargets,
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

  const syncVideoEmbeds = useCallback(
    function syncVideoEmbeds(
      editorRoot: HTMLDivElement,
      paragraphs?: readonly HTMLParagraphElement[],
    ): void {
      const mountRoot = rootRef.current ?? editorRoot;
      setVideoTargets((current) => {
        const next = updateVideoEmbedTargets(editorRoot, current, undefined, mountRoot, paragraphs);
        return haveSameVideoEmbedTargets(current, next) ? current : next;
      });
    },
    [rootRef, setVideoTargets],
  );

  return { syncMermaidPreviews, syncVideoEmbeds };
}
