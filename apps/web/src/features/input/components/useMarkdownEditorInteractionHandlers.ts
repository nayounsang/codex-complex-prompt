import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Crepe } from '@milkdown/crepe';
import { MARKDOWN_UI_REPLACEMENT_MODEL } from '../../../shared/markdown/ui-replacements.js';
import { getDrawingIdFromImage, type DrawingEditTarget } from './markdown-editor-dom.js';
import { isSupportedMediaFile } from '../model/media-files.js';
import type { MediaFileOptions } from './MarkdownEditor.js';

interface ActiveMediaPlaceholderMarker {
  readonly id: string;
  readonly originalAlt: string;
}

interface DrawingActions {
  readonly onEditDrawing: ((id: string) => void) | undefined;
  readonly onDeleteDrawing: ((id: string) => void) | undefined;
  readonly enabled: boolean;
}

interface MarkdownEditorInteractionHandlerOptions {
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly crepeRef: RefObject<Crepe | null>;
  readonly drawingActionsRef: RefObject<DrawingActions>;
  readonly attachmentUrl: string | null | undefined;
  readonly attachmentToken: string | null | undefined;
  readonly readOnly: boolean;
  readonly receiveMediaFiles: (files: readonly File[], options?: MediaFileOptions) => void;
  readonly setDrawingEditTarget: (target: DrawingEditTarget | null) => void;
}

export function useMarkdownEditorInteractionHandlers({
  rootRef,
  crepeRef,
  drawingActionsRef,
  attachmentUrl,
  attachmentToken,
  readOnly,
  receiveMediaFiles,
  setDrawingEditTarget,
}: MarkdownEditorInteractionHandlerOptions) {
  const mediaFileInputRef = useRef<HTMLInputElement>(null);
  const activeMediaPlaceholderMarkerRef = useRef<ActiveMediaPlaceholderMarker | null>(null);
  const hoveredImageRef = useRef<HTMLImageElement | null>(null);
  const hoverRequestIdRef = useRef(0);
  const drawingAvailabilityRef = useRef(
    new Map<string, Promise<{ readonly exists: boolean; readonly editable: boolean }>>(),
  );

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

  const restoreCanceledMediaPlaceholder = useEffectEvent(() => {
    restoreMediaPlaceholder(activeMediaPlaceholderMarkerRef.current);
    activeMediaPlaceholderMarkerRef.current = null;
  });

  useEffect(function restoreMarkerWhenMediaPickerIsCanceled() {
    const input = mediaFileInputRef.current;
    if (input === null) return;
    const handleCancel = (): void => restoreCanceledMediaPlaceholder();
    input.addEventListener('cancel', handleCancel);
    return () => input.removeEventListener('cancel', handleCancel);
  }, []);

  const clearDrawingEditTarget = useCallback((): void => {
    hoverRequestIdRef.current += 1;
    hoveredImageRef.current = null;
    setDrawingEditTarget(null);
  }, [setDrawingEditTarget]);

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
              .then((response) =>
                response.ok
                  ? {
                      exists: true,
                      editable: response.headers.get('X-Attachment-Editable') === 'true',
                    }
                  : { exists: false, editable: false },
              )
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

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('.drawing-actions-overlay') !== null) return;
    const image = target.closest('img');
    if (image instanceof HTMLImageElement) handleDrawingImageHover(image);
    else if (hoveredImageRef.current !== null) clearDrawingEditTarget();
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>): void => {
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

  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>): void => {
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

  const onFocusCapture = (event: FocusEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (target instanceof HTMLImageElement && target.dataset['drawingId'] !== undefined) {
      handleDrawingImageHover(target);
    }
  };

  const onBlurCapture = (
    event: FocusEvent<HTMLDivElement>,
    overlay: HTMLDivElement | null,
  ): void => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && overlay?.contains(nextTarget)) return;
    if (hoveredImageRef.current !== null) clearDrawingEditTarget();
  };

  const onMediaFilesChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.currentTarget.files ?? []).filter(isSupportedMediaFile);
    event.currentTarget.value = '';
    const marker = activeMediaPlaceholderMarkerRef.current;
    activeMediaPlaceholderMarkerRef.current = null;
    if (files.length === 0) {
      restoreMediaPlaceholder(marker);
      return;
    }
    receiveMediaFiles(files, marker === null ? undefined : { placeholderId: marker.id });
  };

  return {
    mediaFileInputRef,
    clearDrawingEditTarget,
    onPointerMove,
    onClickCapture,
    onKeyDownCapture,
    onFocusCapture,
    onBlurCapture,
    onMediaFilesChange,
  };
}
