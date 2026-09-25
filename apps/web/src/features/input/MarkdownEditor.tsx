import {
  forwardRef,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { Crepe } from '@milkdown/crepe';
import type { BlockEditFeatureConfig } from '@milkdown/crepe/feature/block-edit';
import { createAttachmentImageUrl } from '../../attachment-image-url.js';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

export interface MarkdownEditorHandle {
  getMarkdown: () => string;
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
  readonly drawings?: readonly { id: string; label: string }[];
  readonly onDraw?: () => void;
  readonly onEditDrawing?: (id: string) => void;
  readonly onDeleteDrawing?: (id: string) => void;
  readonly onReady?: (root: HTMLDivElement) => void;
}

const crepeFeatures = {
  [Crepe.Feature.ImageBlock]: false,
};

const drawingIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 16.5 9.8-9.8a2.1 2.1 0 0 1 3 3L7 19.5 3.5 20.5 4 16.5Z"/><path d="m12.5 8 3 3"/></svg>';
const drawingIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface DrawingEditTarget {
  readonly id: string;
  readonly image: HTMLImageElement;
}

function getDrawingIdFromImage(
  image: HTMLImageElement,
  attachmentUrl: string | null | undefined,
  attachmentToken: string | null | undefined,
): string | null {
  const source = image.getAttribute('src');
  if (source === null) return null;
  const relativeMatch = source.match(/^(?:\.\/)?\.complex-prompt\/attachments\/([^/]+)\.png$/i);
  if (relativeMatch?.[1] !== undefined && drawingIdPattern.test(relativeMatch[1])) {
    return relativeMatch[1];
  }
  if (attachmentUrl == null || attachmentToken == null) return null;
  try {
    const imageUrl = new URL(source, document.baseURI);
    const baseUrl = new URL(attachmentUrl);
    if (
      imageUrl.origin !== baseUrl.origin ||
      imageUrl.searchParams.get('token') !== attachmentToken
    )
      return null;
    const prefix = `${baseUrl.pathname.replace(/\/+$/, '')}/`;
    if (!imageUrl.pathname.startsWith(prefix)) return null;
    const match = imageUrl.pathname.slice(prefix.length).match(/^([^/]+)\.png$/i);
    return match?.[1] !== undefined && drawingIdPattern.test(match[1]) ? match[1] : null;
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
      drawings = [],
      onDraw,
      onEditDrawing,
      onDeleteDrawing,
      onReady,
    },
    forwardedRef,
  ): React.JSX.Element {
    const rootRef = useRef<HTMLDivElement>(null);
    const hostRef = useRef<HTMLDivElement>(null);
    const crepeRef = useRef<Crepe | null>(null);
    const markdownRef = useRef(defaultMarkdown);
    const hoveredImageRef = useRef<HTMLImageElement | null>(null);
    const hoverRequestIdRef = useRef(0);
    const drawingAvailabilityRef = useRef(new Map<string, Promise<boolean>>());
    const [drawingEditTarget, setDrawingEditTarget] = useState<DrawingEditTarget | null>(null);
    const [drawingEditPosition, setDrawingEditPosition] = useState({ top: 0, left: 0 });
    const [initializationError, setInitializationError] = useState<Error | null>(null);
    const drawingActionsRef = useRef({
      drawings,
      onDraw,
      onEditDrawing,
      onDeleteDrawing,
      enabled: !readOnly,
    });
    drawingActionsRef.current = {
      drawings,
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
    const handleDrawingImageHover = (image: HTMLImageElement): void => {
      const actions = drawingActionsRef.current;
      if (!actions.enabled || actions.onEditDrawing === undefined) return;
      const id = getDrawingIdFromImage(image, attachmentUrl, attachmentToken);
      if (id === null || hoveredImageRef.current === image) return;
      hoveredImageRef.current = image;
      const requestId = ++hoverRequestIdRef.current;
      const cacheKey = `${attachmentUrl ?? ''}\n${attachmentToken ?? ''}\n${id}`;
      let available = drawingAvailabilityRef.current.get(cacheKey);
      if (available === undefined) {
        available =
          attachmentUrl == null || attachmentToken == null
            ? Promise.resolve(false)
            : fetch(`${attachmentUrl}/${id}.json?token=${encodeURIComponent(attachmentToken)}`, {
                method: 'HEAD',
              })
                .then((response) => response.ok)
                .catch(() => false);
        drawingAvailabilityRef.current.set(cacheKey, available);
      }
      void available.then((exists) => {
        if (
          !exists ||
          requestId !== hoverRequestIdRef.current ||
          hoveredImageRef.current !== image ||
          !image.isConnected
        )
          return;
        setDrawingEditTarget({ id, image });
      });
    };
    const handleEditorPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.drawing-edit-overlay') !== null) return;
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
      const image = target.closest('img');
      if (image instanceof HTMLImageElement) handleDrawingImageHover(image);
    };

    useLayoutEffect(
      function positionDrawingEditOverlay() {
        const target = drawingEditTarget;
        const host = hostRef.current;
        if (target === null || host === null) return;
        const updatePosition = (): void => {
          if (!target.image.isConnected) {
            clearDrawingEditTarget();
            return;
          }
          const imageRect = target.image.getBoundingClientRect();
          const hostRect = host.getBoundingClientRect();
          setDrawingEditPosition({
            top: imageRect.top - hostRect.top + host.scrollTop + 6,
            left: imageRect.left - hostRect.left + host.scrollLeft + 6,
          });
        };
        const resizeObserver =
          typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition);
        resizeObserver?.observe(host);
        resizeObserver?.observe(target.image);
        const mutationObserver = new MutationObserver(updatePosition);
        mutationObserver.observe(host, { childList: true, subtree: true });
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        updatePosition();
        return () => {
          resizeObserver?.disconnect();
          mutationObserver.disconnect();
          window.removeEventListener('resize', updatePosition);
          window.removeEventListener('scroll', updatePosition, true);
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
            if (!actions.enabled) return;
            const advanced = builder.getGroup('advanced');
            advanced.addItem('draw', {
              label: 'Draw',
              icon: drawingIcon,
              onRun: () => actions.onDraw?.(),
            });
            for (const drawing of actions.drawings) {
              if (actions.onEditDrawing !== undefined) {
                advanced.addItem(`edit-${drawing.id}`, {
                  label: `Edit: ${drawing.label}`,
                  icon: drawingIcon,
                  onRun: () => drawingActionsRef.current.onEditDrawing?.(drawing.id),
                });
              }
              if (actions.onDeleteDrawing !== undefined) {
                advanced.addItem(`delete-${drawing.id}`, {
                  label: `Delete: ${drawing.label}`,
                  icon: drawingIcon,
                  onRun: () => drawingActionsRef.current.onDeleteDrawing?.(drawing.id),
                });
              }
            }
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
          const files =
            'clipboardData' in event ? event.clipboardData?.files : event.dataTransfer?.files;
          if (files !== undefined && files.length > 0) {
            event.preventDefault();
            event.stopPropagation();
          }
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
        {drawingEditTarget !== null && !readOnly && (
          <button
            type="button"
            className="drawing-edit-overlay"
            style={{ top: drawingEditPosition.top, left: drawingEditPosition.left }}
            aria-label="그림 편집"
            title="그림 편집"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => drawingActionsRef.current.onEditDrawing?.(drawingEditTarget.id)}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m4 16.5 9.8-9.8a2.1 2.1 0 0 1 3 3L7 19.5 3.5 20.5 4 16.5Z" />
              <path d="m12.5 8 3 3" />
            </svg>
          </button>
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
    const match = image
      .getAttribute('src')
      ?.match(/^\.complex-prompt\/attachments\/([0-9a-f-]{36})\.png$/i);
    if (match?.[1] === undefined) continue;
    const url = createAttachmentImageUrl(
      attachmentUrl,
      match[1],
      attachmentToken,
      attachmentRefreshKey,
    );
    if (image.src !== url) image.src = url;
  }
}
