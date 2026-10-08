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
import type { Crepe } from '@milkdown/crepe';
import { editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import type { VideoEmbedTarget } from '../../../shared/markdown/video-embeds.js';
import { MarkdownEditorAuxiliaryViews } from './MarkdownEditorAuxiliaryViews.js';
import { isSupportedMediaFile } from '../model/media-files.js';
import { useMarkdownEditorLifecycle } from './useMarkdownEditorLifecycle.js';
import type { MermaidDiagramTarget } from './MermaidDiagramCard.js';
import { MARKDOWN_UI_REPLACEMENT_MODEL } from '../../../shared/markdown/ui-replacements.js';
import {
  getDrawingIdFromImage,
  syncMediaPlaceholderAccessibility,
  type DrawingEditTarget,
} from './markdown-editor-dom.js';
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
    useMarkdownEditorLifecycle({
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
    });
    useImperativeHandle(
      forwardedRef,
      () => ({
        getMarkdown: () => crepeRef.current?.getMarkdown() ?? markdownRef.current,
      }),
      [],
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
        <MarkdownEditorAuxiliaryViews
          drawingActions={drawingActionsRef.current}
          drawingActionsOverlayRef={drawingActionsOverlayRef}
          drawingEditTarget={drawingEditTarget}
          drawingEditPosition={drawingEditPosition}
          mermaidTargets={mermaidTargets}
          videoTargets={videoTargets}
          mermaidDialogTarget={mermaidDialogTarget}
          readOnly={readOnly}
          onClearDrawingEditTarget={clearDrawingEditTarget}
          onEditMermaid={setMermaidDialogTarget}
          onCloseMermaid={() => setMermaidDialogTarget(null)}
          onReplaceMermaid={replaceCurrentMermaidBlock}
        />
      </div>
    );
  },
);
