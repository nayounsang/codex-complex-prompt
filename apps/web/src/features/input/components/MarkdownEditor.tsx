import {
  forwardRef,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { autoUpdate, computePosition, offset } from '@floating-ui/dom';
import { Crepe } from '@milkdown/crepe';
import type { BlockEditFeatureConfig } from '@milkdown/crepe/feature/block-edit';
import { editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import { NodeSelection } from '@milkdown/kit/prose/state';
import { createAttachmentImageUrl } from '../../../attachment-image-url.js';
import {
  hasMermaidRelevantMutations,
  hasRemovedMermaidPreviewCard,
} from './mermaid-preview-observer.js';
import {
  createMermaidPreviewTargets,
  haveSameMermaidPreviewTargets,
} from './mermaid-preview-targets.js';
import {
  getVideoEmbedAffectedParagraphs,
  haveSameVideoEmbedTargets,
  updateVideoEmbedTargets,
  type VideoEmbedTarget,
} from '../../../shared/markdown/video-embeds.js';
import { VideoEmbedPreview } from './VideoEmbedPreview.js';
import { addMarkdownEditorAdvancedMenu } from './markdown-editor-menu.js';
import { SvgIcon } from '../../../shared/icons/SvgIcon.js';
import { isSupportedMediaFile } from '../model/media-files.js';
import { MermaidDiagramCard, MermaidDiagramDialog } from './MermaidDiagramCard.js';
import type { MermaidDiagramTarget } from './MermaidDiagramCard.js';
import {
  getConfiguredAttachmentId,
  getMarkdownAttachmentId,
  getMarkdownAttachmentExtension,
} from '../../../shared/markdown/attachment-path.js';
import { MARKDOWN_UI_REPLACEMENT_MODEL } from '../../../shared/markdown/ui-replacements.js';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

export interface MarkdownEditorHandle {
  getMarkdown: () => string;
}

export interface MediaFileOptions {
  readonly placeholderId: string;
}

interface ActiveMediaPlaceholderMarker {
  readonly id: string;
  readonly originalAlt: string;
}

export interface MarkdownEditorProps {
  readonly defaultMarkdown?: string;
  readonly readOnly?: boolean;
  readonly onMarkdownChange?: (markdown: string) => void;
  readonly className?: string;
  readonly testId?: string;
  readonly ariaLabel?: string;
  readonly attachmentUrl?: string | null;
  readonly attachmentToken?: string | null;
  readonly attachmentRefreshKey?: number;
  readonly onDraw?: () => void;
  readonly onMediaFiles?: (
    files: readonly File[],
    options?: MediaFileOptions,
  ) => void | Promise<void>;
  readonly onImageFiles?: (files: readonly File[]) => void | Promise<void>;
  readonly onEditDrawing?: (id: string) => void;
  readonly onDeleteDrawing?: (id: string) => void;
  readonly onReady?: (root: HTMLDivElement) => void;
}

const crepeFeatures = {
  [Crepe.Feature.ImageBlock]: false,
};

function syncMediaPlaceholderAccessibility(root: HTMLElement, readOnly: boolean): void {
  const placeholders = Array.from(
    root.querySelectorAll<HTMLParagraphElement>('.ProseMirror p:has(> img[src=""])'),
  );
  const dedicatedPlaceholders = placeholders.filter((paragraph) => {
    const image = paragraph.querySelector(':scope > img[src=""]');
    return (
      image instanceof HTMLImageElement &&
      Array.from(paragraph.childNodes).every(
        (child) =>
          child === image ||
          (child instanceof HTMLImageElement &&
            child.classList.contains('ProseMirror-separator')) ||
          (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() === '') ||
          (child instanceof HTMLBRElement && child.classList.contains('ProseMirror-trailingBreak')),
      )
    );
  });
  const currentPlaceholders = new Set(dedicatedPlaceholders);
  root.querySelectorAll<HTMLParagraphElement>('p[data-media-placeholder]').forEach((paragraph) => {
    if (readOnly || !currentPlaceholders.has(paragraph)) {
      paragraph.removeAttribute('data-media-placeholder');
      paragraph.removeAttribute('data-markdown-ui-replacement');
      paragraph.removeAttribute('role');
      paragraph.removeAttribute('tabindex');
      paragraph.removeAttribute('aria-label');
      paragraph.removeAttribute('aria-disabled');
    }
  });
  if (readOnly) return;
  dedicatedPlaceholders.forEach((paragraph) => {
    const image = paragraph.querySelector(':scope > img[src=""]');
    const isUploading =
      image
        ?.getAttribute('alt')
        ?.startsWith(MARKDOWN_UI_REPLACEMENT_MODEL.mediaPlaceholder.pendingPrefix) === true;
    paragraph.setAttribute('data-media-placeholder', 'true');
    paragraph.dataset['markdownUiReplacement'] =
      MARKDOWN_UI_REPLACEMENT_MODEL.mediaPlaceholder.kind;
    paragraph.setAttribute('role', 'button');
    paragraph.setAttribute('tabindex', isUploading ? '-1' : '0');
    paragraph.setAttribute('aria-label', isUploading ? 'Uploading media' : 'Add media');
    if (isUploading) paragraph.setAttribute('aria-disabled', 'true');
    else paragraph.removeAttribute('aria-disabled');
  });
}

interface DrawingEditTarget {
  readonly id: string;
  readonly image: HTMLImageElement;
  readonly editable: boolean;
}

function getDrawingIdFromImage(
  image: HTMLImageElement,
  attachmentUrl: string | null | undefined,
  attachmentToken: string | null | undefined,
): string | null {
  const source = image.getAttribute('src');
  if (source === null) return null;
  const markdownId = getMarkdownAttachmentId(source);
  if (markdownId !== null) return markdownId;
  if (attachmentUrl == null || attachmentToken == null) return null;
  try {
    const imageUrl = new URL(source, document.baseURI);
    if (imageUrl.searchParams.get('token') !== attachmentToken) return null;
    return getConfiguredAttachmentId(source, attachmentUrl);
  } catch {
    return null;
  }
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      defaultMarkdown = '',
      readOnly = false,
      onMarkdownChange,
      className,
      testId = 'markdown-editor',
      ariaLabel = 'Markdown command editor',
      attachmentUrl,
      attachmentToken,
      attachmentRefreshKey = 0,
      onDraw,
      onMediaFiles,
      onImageFiles,
      onEditDrawing,
      onDeleteDrawing,
      onReady,
    },
    forwardedRef,
  ): React.JSX.Element {
    const rootRef = useRef<HTMLDivElement>(null);
    const hostRef = useRef<HTMLDivElement>(null);
    const mediaFileInputRef = useRef<HTMLInputElement>(null);
    const activeMediaPlaceholderMarkerRef = useRef<ActiveMediaPlaceholderMarker | null>(null);
    const setMediaPlaceholderAlt = (image: HTMLImageElement, alt: string): boolean => {
      const editor = crepeRef.current?.editor;
      if (editor === undefined) return false;
      let updated = false;
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const position = view.posAtDOM(image, 0);
        const node = view.state.doc.nodeAt(position);
        if (node?.type.name !== 'image') return;
        view.dispatch(view.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, alt }));
        updated = true;
      });
      return updated;
    };
    const markMediaPlaceholder = (image: HTMLImageElement): void => {
      const originalAlt = image.getAttribute('alt') ?? '';
      const placeholderId = `${MARKDOWN_UI_REPLACEMENT_MODEL.mediaPlaceholder.markerPrefix}${globalThis.crypto.randomUUID()}`;
      if (!setMediaPlaceholderAlt(image, placeholderId)) return;
      activeMediaPlaceholderMarkerRef.current = { id: placeholderId, originalAlt };
    };
    const restoreMediaPlaceholder = (marker: ActiveMediaPlaceholderMarker | null): void => {
      if (marker === null) return;
      const root = rootRef.current;
      const image = Array.from(
        root?.querySelectorAll<HTMLImageElement>('.ProseMirror img[src=""]') ?? [],
      ).find((candidate) => candidate.getAttribute('alt') === marker.id);
      if (image !== undefined) setMediaPlaceholderAlt(image, marker.originalAlt);
    };
    const restoreCanceledMediaPlaceholder = useEffectEvent(
      function restoreCanceledMediaPlaceholderMarker(): void {
        restoreMediaPlaceholder(activeMediaPlaceholderMarkerRef.current);
        activeMediaPlaceholderMarkerRef.current = null;
      },
    );
    useEffect(function restoreMarkerWhenMediaPickerIsCanceled() {
      const input = mediaFileInputRef.current;
      if (input === null) return;
      const handleCancel = (): void => restoreCanceledMediaPlaceholder();
      input.addEventListener('cancel', handleCancel);
      return () => input.removeEventListener('cancel', handleCancel);
    }, []);
    const crepeRef = useRef<Crepe | null>(null);
    const markdownRef = useRef(defaultMarkdown);
    const hoveredImageRef = useRef<HTMLImageElement | null>(null);
    const hoverRequestIdRef = useRef(0);
    const drawingAvailabilityRef = useRef(
      new Map<string, Promise<{ readonly exists: boolean; readonly editable: boolean }>>(),
    );
    const [drawingEditTarget, setDrawingEditTarget] = useState<DrawingEditTarget | null>(null);
    const [mermaidTargets, setMermaidTargets] = useState<MermaidDiagramTarget[]>([]);
    const [videoTargets, setVideoTargets] = useState<VideoEmbedTarget[]>([]);
    const [mermaidDialogTarget, setMermaidDialogTarget] = useState<MermaidDiagramTarget | null>(
      null,
    );
    const [drawingEditPosition, setDrawingEditPosition] = useState({ top: 0, left: 0 });
    const drawingActionsOverlayRef = useRef<HTMLDivElement>(null);
    const [initializationError, setInitializationError] = useState<Error | null>(null);
    const drawingActionsRef = useRef({
      onDraw,
      onEditDrawing,
      onDeleteDrawing,
      enabled: !readOnly,
    });
    drawingActionsRef.current = {
      onDraw,
      onEditDrawing,
      onDeleteDrawing,
      enabled: !readOnly,
    };

    const clearDrawingEditTarget = (): void => {
      hoverRequestIdRef.current += 1;
      hoveredImageRef.current = null;
      setDrawingEditTarget(null);
    };
    const syncMermaidPreviews = (
      editorRoot: HTMLDivElement,
      recoverRemovedPreview = false,
    ): void => {
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
      setMermaidTargets((current) => {
        if (haveSameMermaidPreviewTargets(current, targets)) return current;
        return targets;
      });
    };
    const syncVideoEmbeds = (
      editorRoot: HTMLDivElement,
      paragraphs?: readonly HTMLParagraphElement[],
    ): void => {
      const mountRoot = rootRef.current ?? editorRoot;
      setVideoTargets((current) => {
        const next = updateVideoEmbedTargets(editorRoot, current, undefined, mountRoot, paragraphs);
        return haveSameVideoEmbedTargets(current, next) ? current : next;
      });
    };
    const replaceMermaidBlock = (target: MermaidDiagramTarget, source?: string): boolean => {
      const editor = crepeRef.current?.editor;
      if (editor === undefined) return false;
      let replaced = false;
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const schema = ctx.get(schemaCtx);
        const pos = target.position;
        const node = view.state.doc.nodeAt(pos);
        if (
          node === null ||
          node.type.name !== 'code_block' ||
          String(node.attrs['language']).toLowerCase() !==
            MARKDOWN_UI_REPLACEMENT_MODEL.mermaid.language ||
          node.textContent !== target.source
        )
          return;
        const replacement =
          source === undefined
            ? schema.nodes['paragraph']?.create()
            : schema.nodes['code_block']?.create(
                { ...node.attrs, language: MARKDOWN_UI_REPLACEMENT_MODEL.mermaid.language },
                source === '' ? undefined : schema.text(source),
              );
        if (replacement === undefined) return;
        view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, replacement));
        view.focus();
        replaced = true;
      });
      return replaced;
    };
    const replaceCurrentMermaidBlock = (target: MermaidDiagramTarget, source?: string): boolean => {
      return replaceMermaidBlock(target, source);
    };
    const handleDrawingImageHover = (image: HTMLImageElement): void => {
      const actions = drawingActionsRef.current;
      if (
        !actions.enabled ||
        (actions.onEditDrawing === undefined && actions.onDeleteDrawing === undefined)
      )
        return;
      const id = getDrawingIdFromImage(image, attachmentUrl, attachmentToken);
      if (id === null || hoveredImageRef.current === image) return;
      hoveredImageRef.current = image;
      const requestId = ++hoverRequestIdRef.current;
      const cacheKey = `${attachmentUrl ?? ''}\n${attachmentToken ?? ''}\n${id}`;
      let available = drawingAvailabilityRef.current.get(cacheKey);
      if (available === undefined) {
        available =
          attachmentUrl == null || attachmentToken == null
            ? Promise.resolve({ exists: false, editable: false })
            : fetch(`${attachmentUrl}/${id}.json?token=${encodeURIComponent(attachmentToken)}`, {
                method: 'HEAD',
              })
                .then((response) => {
                  if (!response.ok) return { exists: false, editable: false };
                  return {
                    exists: true,
                    editable: response.headers.get('X-Attachment-Editable') === 'true',
                  };
                })
                .catch(() => ({ exists: false, editable: false }));
        drawingAvailabilityRef.current.set(cacheKey, available);
      }
      void available.then((result) => {
        if (
          !result.exists ||
          requestId !== hoverRequestIdRef.current ||
          hoveredImageRef.current !== image ||
          !image.isConnected
        )
          return;
        setDrawingEditTarget({ id, image, editable: result.editable });
      });
    };
    const handleEditorPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.drawing-actions-overlay') !== null) return;
      const image = target.closest('img');
      if (image instanceof HTMLImageElement) {
        handleDrawingImageHover(image);
      } else if (hoveredImageRef.current !== null) {
        clearDrawingEditTarget();
      }
    };
    const handleEditorClickCapture = (event: React.MouseEvent<HTMLDivElement>): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const placeholder = target.closest('.ProseMirror p[data-media-placeholder="true"]');
      if (placeholder !== null && !readOnly) {
        const image = placeholder.querySelector(':scope > img[src=""]');
        if (
          image
            ?.getAttribute('alt')
            ?.startsWith(MARKDOWN_UI_REPLACEMENT_MODEL.mediaPlaceholder.pendingPrefix) === true
        ) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        if (image instanceof HTMLImageElement) markMediaPlaceholder(image);
        mediaFileInputRef.current?.click();
        return;
      }
      const image = target.closest('img');
      if (image instanceof HTMLImageElement) handleDrawingImageHover(image);
    };
    const handleEditorKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (!readOnly) {
        const target = event.target;
        const placeholder =
          target instanceof Element
            ? target.closest('.ProseMirror p[data-media-placeholder="true"]')
            : null;
        if (placeholder !== null) {
          const image = placeholder.querySelector(':scope > img[src=""]');
          if (
            image
              ?.getAttribute('alt')
              ?.startsWith(MARKDOWN_UI_REPLACEMENT_MODEL.mediaPlaceholder.pendingPrefix) === true
          ) {
            event.preventDefault();
            return;
          }
          event.preventDefault();
          if (image instanceof HTMLImageElement) markMediaPlaceholder(image);
          mediaFileInputRef.current?.click();
          return;
        }
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const image = target.closest<HTMLImageElement>('img[data-drawing-id]');
      if (image === null) return;
      event.preventDefault();
      handleDrawingImageHover(image);
    };
    const handleEditorFocusCapture = (event: React.FocusEvent<HTMLDivElement>): void => {
      const target = event.target;
      if (target instanceof HTMLImageElement && target.dataset['drawingId'] !== undefined) {
        handleDrawingImageHover(target);
      }
    };
    const handleEditorBlurCapture = (event: React.FocusEvent<HTMLDivElement>): void => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && drawingActionsOverlayRef.current?.contains(nextTarget)) {
        return;
      }
      if (hoveredImageRef.current !== null) clearDrawingEditTarget();
    };

    useLayoutEffect(
      function positionDrawingEditOverlay() {
        const target = drawingEditTarget;
        const overlay = drawingActionsOverlayRef.current;
        if (target === null || overlay === null) return;
        let active = true;
        const updatePosition = (): void => {
          if (!target.image.isConnected) {
            clearDrawingEditTarget();
            return;
          }
          void computePosition(target.image, overlay, {
            placement: 'top-start',
            strategy: 'absolute',
            middleware: [offset(-32)],
          }).then(({ x, y }) => {
            if (!active || !target.image.isConnected) return;
            setDrawingEditPosition({ top: y, left: x });
          });
        };
        const stopAutoUpdate = autoUpdate(target.image, overlay, updatePosition);
        return () => {
          active = false;
          stopAutoUpdate();
        };
      },
      [drawingEditTarget],
    );
    const notifyMarkdownChange = useEffectEvent((markdown: string) => {
      onMarkdownChange?.(markdown);
    });
    const getCurrentReadOnly = useEffectEvent(() => readOnly);
    const getEditorAriaLabel = useEffectEvent(() =>
      ariaLabel === 'Markdown command editor' ? 'Command' : ariaLabel,
    );
    const notifyReady = useEffectEvent((root: HTMLDivElement) => {
      onReady?.(root);
    });
    const receiveMediaFiles = useEffectEvent(
      (files: readonly File[], options?: MediaFileOptions) => {
        const receiveFiles = onMediaFiles ?? onImageFiles;
        if (options === undefined) void receiveFiles?.(files);
        else void receiveFiles?.(files, options);
      },
    );
    const insertMermaidDiagram = (): void => {
      const editor = crepeRef.current?.editor;
      if (editor === undefined) return;
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const schema = ctx.get(schemaCtx);
        const codeBlock = schema.nodes['code_block'];
        if (codeBlock === undefined) return;
        const block = codeBlock.create({
          language: MARKDOWN_UI_REPLACEMENT_MODEL.mermaid.language,
        });
        const transaction = view.state.tr.replaceSelectionWith(block);
        view.dispatch(transaction);
        view.focus();
      });
    };
    const insertMediaPlaceholder = (): void => {
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
    };

    useImperativeHandle(
      forwardedRef,
      () => ({
        getMarkdown: () => crepeRef.current?.getMarkdown() ?? markdownRef.current,
      }),
      [],
    );

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
          [Crepe.Feature.Placeholder]: {
            mode: 'doc' as const,
            text: 'Start writing…',
          },
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
            stableProseMirror.setAttribute('aria-label', getEditorAriaLabel());
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
      [attachmentRefreshKey, attachmentToken, attachmentUrl, defaultMarkdown],
    );

    useEffect(
      function syncMarkdownEditorReadOnlyState() {
        crepeRef.current?.setReadonly(readOnly);
        const root = rootRef.current;
        if (root !== null) syncMediaPlaceholderAccessibility(root, readOnly);
      },
      [readOnly],
    );

    if (initializationError !== null) {
      throw initializationError;
    }

    return (
      <div
        ref={hostRef}
        className="markdown-editor-host"
        onPointerMove={handleEditorPointerMove}
        onPointerLeave={clearDrawingEditTarget}
        onClickCapture={handleEditorClickCapture}
        onKeyDownCapture={handleEditorKeyDownCapture}
        onFocusCapture={handleEditorFocusCapture}
        onBlurCapture={handleEditorBlurCapture}
      >
        <div
          ref={rootRef}
          id="markdown-editor"
          className={`markdown-editor markdown-surface markdown-content${className === undefined ? '' : ` ${className}`}`}
          data-testid={testId}
          role="group"
          aria-label={ariaLabel}
          aria-disabled={readOnly}
        />
        <input
          ref={mediaFileInputRef}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/tiff,image/svg+xml,video/mp4,video/quicktime,video/webm,.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp,.tif,.tiff,.svg,.mp4,.mov,.webm"
          aria-label="Choose image or video files"
          aria-hidden="true"
          tabIndex={-1}
          disabled={readOnly}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []).filter(isSupportedMediaFile);
            event.currentTarget.value = '';
            const marker = activeMediaPlaceholderMarkerRef.current;
            activeMediaPlaceholderMarkerRef.current = null;
            if (files.length === 0) {
              restoreMediaPlaceholder(marker);
              return;
            }
            receiveMediaFiles(files, marker === null ? undefined : { placeholderId: marker.id });
          }}
        />
        {drawingEditTarget !== null && !readOnly && (
          <div
            ref={drawingActionsOverlayRef}
            className="drawing-actions-overlay"
            style={drawingEditPosition}
          >
            {drawingEditTarget.editable &&
              drawingActionsRef.current.onEditDrawing !== undefined && (
                <button
                  type="button"
                  className="drawing-edit-overlay"
                  aria-label="Edit drawing"
                  title="Edit drawing"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => drawingActionsRef.current.onEditDrawing?.(drawingEditTarget.id)}
                >
                  <SvgIcon name="pencil" />
                </button>
              )}
            {drawingActionsRef.current.onDeleteDrawing !== undefined && (
              <button
                type="button"
                className="drawing-edit-overlay"
                aria-label="Delete drawing"
                title="Delete drawing"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  drawingActionsRef.current.onDeleteDrawing?.(drawingEditTarget.id);
                  clearDrawingEditTarget();
                }}
              >
                <SvgIcon name="trash" />
              </button>
            )}
          </div>
        )}
        {mermaidTargets.map((target) => (
          <MermaidDiagramCard
            key={target.id}
            target={target}
            readOnly={readOnly}
            onEdit={setMermaidDialogTarget}
            onReplace={replaceCurrentMermaidBlock}
          />
        ))}
        {videoTargets.map((target) => (
          <VideoEmbedPreview key={`${target.id}:${target.source}`} target={target} />
        ))}
        {mermaidDialogTarget !== null && (
          <MermaidDiagramDialog
            key={mermaidDialogTarget.id}
            target={mermaidDialogTarget}
            onClose={() => setMermaidDialogTarget(null)}
            onReplace={replaceCurrentMermaidBlock}
          />
        )}
      </div>
    );
  },
);

function replaceAttachmentImageUrls(
  root: HTMLDivElement,
  attachmentUrl: string | null | undefined,
  attachmentToken: string | null | undefined,
  attachmentRefreshKey: number,
): void {
  if (
    attachmentUrl === null ||
    attachmentUrl === undefined ||
    attachmentToken === null ||
    attachmentToken === undefined
  )
    return;
  for (const image of root.querySelectorAll<HTMLImageElement>('img[src]')) {
    const source = image.getAttribute('src');
    const id = source === null ? null : getMarkdownAttachmentId(source);
    const extension = source === null ? null : getMarkdownAttachmentExtension(source);
    if (id === null || extension === null) continue;
    const url = createAttachmentImageUrl(
      attachmentUrl,
      id,
      attachmentToken,
      attachmentRefreshKey,
      extension,
    );
    image.tabIndex = 0;
    image.dataset['drawingId'] = id;
    image.dataset['markdownUiReplacement'] = MARKDOWN_UI_REPLACEMENT_MODEL.drawing.kind;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', `Drawing actions: ${image.alt.trim() || 'Drawing'}`);
    if (['mp4', 'mov', 'webm'].includes(extension)) {
      image.dataset['videoSource'] = url;
      const inertImage = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
      if (image.src !== inertImage) image.src = inertImage;
    } else if (image.src !== url) {
      image.src = url;
    }
  }
}
