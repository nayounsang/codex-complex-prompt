import {
  useEffect,
  useEffectEvent,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Crepe } from '@milkdown/crepe';
import type { BlockEditFeatureConfig } from '@milkdown/crepe/feature/block-edit';
import { editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import { NodeSelection } from '@milkdown/kit/prose/state';

import {
  hasMermaidRelevantMutations,
  hasRemovedMermaidPreviewCard,
} from './mermaid-preview-observer.js';
import {
  createMermaidPreviewTargets,
  haveSameMermaidPreviewTargets,
} from './mermaid-preview-targets.js';
import { addMarkdownEditorAdvancedMenu } from './markdown-editor-menu.js';
import { isSupportedMediaFile } from '../model/media-files.js';
import { MARKDOWN_UI_REPLACEMENT_MODEL } from '../../../shared/markdown/ui-replacements.js';
import {
  getVideoEmbedAffectedParagraphs,
  haveSameVideoEmbedTargets,
  updateVideoEmbedTargets,
  type VideoEmbedTarget,
} from '../../../shared/markdown/video-embeds.js';
import {
  replaceAttachmentImageUrls,
  syncMediaPlaceholderAccessibility,
} from './markdown-editor-dom.js';

const crepeFeatures = {
  [Crepe.Feature.ImageBlock]: false,
};

interface DrawingActions {
  readonly enabled: boolean;
  readonly onDraw: (() => void) | undefined;
}

interface MarkdownEditorLifecycleOptions {
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly crepeRef: RefObject<Crepe | null>;
  readonly markdownRef: RefObject<string>;
  readonly drawingActionsRef: RefObject<DrawingActions>;
  readonly defaultMarkdown: string;
  readonly attachmentUrl: string | null | undefined;
  readonly attachmentToken: string | null | undefined;
  readonly attachmentRefreshKey: number;
  readonly getCurrentReadOnly: () => boolean;
  readonly getEditorAriaLabel: () => string | undefined;
  readonly notifyMarkdownChange: (markdown: string) => void;
  readonly notifyReady: (root: HTMLDivElement) => void;
  readonly receiveMediaFiles: (files: readonly File[]) => void;
  readonly setInitializationError: Dispatch<SetStateAction<Error | null>>;
  readonly setMermaidTargets: Dispatch<
    SetStateAction<ReturnType<typeof createMermaidPreviewTargets>>
  >;
  readonly setVideoTargets: Dispatch<SetStateAction<VideoEmbedTarget[]>>;
}

export function useMarkdownEditorLifecycle({
  rootRef,
  crepeRef,
  markdownRef,
  drawingActionsRef,
  defaultMarkdown,
  attachmentUrl,
  attachmentToken,
  attachmentRefreshKey,
  getCurrentReadOnly,
  getEditorAriaLabel,
  notifyMarkdownChange,
  notifyReady,
  receiveMediaFiles,
  setInitializationError,
  setMermaidTargets,
  setVideoTargets,
}: MarkdownEditorLifecycleOptions): void {
  const syncMermaidPreviews = useEffectEvent(function syncMermaidPreviews(
    editorRoot: HTMLDivElement,
    recoverRemovedPreview = false,
  ): void {
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
  });

  const syncVideoEmbeds = useEffectEvent(function syncVideoEmbeds(
    editorRoot: HTMLDivElement,
    paragraphs?: readonly HTMLParagraphElement[],
  ): void {
    const mountRoot = rootRef.current ?? editorRoot;
    setVideoTargets((current) => {
      const next = updateVideoEmbedTargets(editorRoot, current, undefined, mountRoot, paragraphs);
      return haveSameVideoEmbedTargets(current, next) ? current : next;
    });
  });

  const insertMermaidDiagram = useEffectEvent(function insertMermaidDiagram(): void {
    const editor = crepeRef.current?.editor;
    if (editor === undefined) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const schema = ctx.get(schemaCtx);
      const codeBlock = schema.nodes['code_block'];
      if (codeBlock === undefined) return;
      const block = codeBlock.create({ language: MARKDOWN_UI_REPLACEMENT_MODEL.mermaid.language });
      view.dispatch(view.state.tr.replaceSelectionWith(block));
      view.focus();
    });
  });

  const insertMediaPlaceholder = useEffectEvent(function insertMediaPlaceholder(): void {
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
  });

  useEffect(
    function initializeMarkdownEditor() {
      const root = rootRef.current;
      if (root === null) return;
      const editorRoot: HTMLDivElement = root;
      const blockEditConfig: BlockEditFeatureConfig = {
        slashMenu: {},
        buildMenu: (builder) => {
          const actions = drawingActionsRef.current;
          addMarkdownEditorAdvancedMenu(builder, actions.enabled, {
            draw: () => actions.onDraw?.(),
            diagram: insertMermaidDiagram,
            media: insertMediaPlaceholder,
          });
        },
      };
      const featureConfigs = {
        [Crepe.Feature.BlockEdit]: blockEditConfig,
        [Crepe.Feature.Placeholder]: { mode: 'doc' as const, text: 'Start writing…' },
      };

      let disposed = false;
      let crepe: Crepe | null = null;
      const blockFileTransfer = (event: ClipboardEvent | DragEvent): void => {
        const transfer = 'clipboardData' in event ? event.clipboardData : event.dataTransfer;
        const files = transfer === null ? [] : Array.from(transfer.files);
        if (files.length === 0 && 'clipboardData' in event && transfer !== null) {
          for (const item of Array.from(transfer.items)) {
            if (item.kind !== 'file') continue;
            const file = item.getAsFile();
            if (file !== null) files.push(file);
          }
        }
        const mediaFiles = files.filter(isSupportedMediaFile);
        if (mediaFiles.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        receiveMediaFiles(mediaFiles);
      };
      editorRoot.addEventListener('paste', blockFileTransfer, true);
      editorRoot.addEventListener('drop', blockFileTransfer, true);

      crepe = new Crepe({
        root: editorRoot,
        defaultValue: defaultMarkdown,
        features: crepeFeatures,
        featureConfigs,
      });
      crepeRef.current = crepe;
      crepe.setReadonly(getCurrentReadOnly());
      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, markdown) => {
          markdownRef.current = markdown;
          notifyMarkdownChange(markdown);
        });
      });

      let readyTimer: number | undefined;
      let attachmentObserver: MutationObserver | undefined;
      let mediaPlaceholderObserver: MutationObserver | undefined;
      let mermaidObserver: MutationObserver | undefined;
      let videoObserver: MutationObserver | undefined;
      const syncInitialMarkdown = (): void => {
        if (disposed) return;
        replaceAttachmentImageUrls(
          editorRoot,
          attachmentUrl,
          attachmentToken,
          attachmentRefreshKey,
        );
        const proseMirror = editorRoot.querySelector<HTMLElement>('.ProseMirror');
        if (proseMirror === null) return;
        if (readyTimer !== undefined) window.clearTimeout(readyTimer);
        readyTimer = window.setTimeout(() => {
          if (disposed) return;
          const stableProseMirror = editorRoot.querySelector<HTMLElement>('.ProseMirror');
          if (stableProseMirror === null) return;
          editorObserver.disconnect();
          attachmentObserver = new MutationObserver(() =>
            replaceAttachmentImageUrls(
              editorRoot,
              attachmentUrl,
              attachmentToken,
              attachmentRefreshKey,
            ),
          );
          attachmentObserver.observe(editorRoot, { childList: true, subtree: true });
          stableProseMirror.setAttribute('aria-label', getEditorAriaLabel() ?? '');
          notifyReady(editorRoot);
          syncMediaPlaceholderAccessibility(editorRoot, getCurrentReadOnly());
          syncMermaidPreviews(editorRoot);
          syncVideoEmbeds(editorRoot);
          mediaPlaceholderObserver = new MutationObserver(() =>
            syncMediaPlaceholderAccessibility(editorRoot, getCurrentReadOnly()),
          );
          mediaPlaceholderObserver.observe(stableProseMirror, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['alt', 'src'],
          });
          mermaidObserver = new MutationObserver((records) => {
            if (hasMermaidRelevantMutations(records)) {
              syncMermaidPreviews(editorRoot, hasRemovedMermaidPreviewCard(records));
            }
          });
          mermaidObserver.observe(stableProseMirror, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class'],
          });
          videoObserver = new MutationObserver((records) =>
            syncVideoEmbeds(editorRoot, getVideoEmbedAffectedParagraphs(editorRoot, records)),
          );
          videoObserver.observe(stableProseMirror, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['href'],
          });
          markdownRef.current = crepe?.getMarkdown() ?? defaultMarkdown;
          notifyMarkdownChange(markdownRef.current);
        }, 50);
      };
      const editorObserver = new MutationObserver(syncInitialMarkdown);
      editorObserver.observe(editorRoot, { childList: true, subtree: true });

      void crepe
        .create()
        .then(function syncInitialMarkdownAfterCreate() {
          syncInitialMarkdown();
        })
        .catch(function reportFailedEditor(error: unknown) {
          if (disposed) return;
          crepeRef.current = null;
          setInitializationError(
            error instanceof Error ? error : new Error('The Markdown editor failed to load.'),
          );
        });

      return () => {
        disposed = true;
        if (readyTimer !== undefined) window.clearTimeout(readyTimer);
        editorObserver.disconnect();
        attachmentObserver?.disconnect();
        mediaPlaceholderObserver?.disconnect();
        mermaidObserver?.disconnect();
        videoObserver?.disconnect();
        editorRoot.removeEventListener('paste', blockFileTransfer, true);
        editorRoot.removeEventListener('drop', blockFileTransfer, true);
        crepeRef.current = null;
        if (crepe !== null) void crepe.destroy();
      };
    },
    // Effect-event callbacks and refs are intentionally read at event time, not used as lifecycle triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attachmentRefreshKey, attachmentToken, attachmentUrl, defaultMarkdown],
  );
}
