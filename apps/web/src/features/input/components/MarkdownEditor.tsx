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
import { useMarkdownEditorLifecycle } from './useMarkdownEditorLifecycle.js';
import { useMarkdownEditorInteractionHandlers } from './useMarkdownEditorInteractionHandlers.js';
import type { MermaidDiagramTarget } from './MermaidDiagramCard.js';
import { MARKDOWN_UI_REPLACEMENT_MODEL } from '../../../shared/markdown/ui-replacements.js';
import {
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
    const crepeRef = useRef<Crepe | null>(null);
    const markdownRef = useRef(defaultMarkdown);
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

    const interactionHandlers = useMarkdownEditorInteractionHandlers({
      rootRef,
      crepeRef,
      drawingActionsRef,
      attachmentUrl,
      attachmentToken,
      readOnly,
      receiveMediaFiles: (files, options) => {
        const receiveFiles = onMediaFiles ?? onImageFiles;
        if (options === undefined) void receiveFiles?.(files);
        else void receiveFiles?.(files, options);
      },
      setDrawingEditTarget,
    });
    const { clearDrawingEditTarget } = interactionHandlers;
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
      [drawingEditTarget, clearDrawingEditTarget],
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
        onPointerMove={interactionHandlers.onPointerMove}
        onPointerLeave={interactionHandlers.clearDrawingEditTarget}
        onClickCapture={interactionHandlers.onClickCapture}
        onKeyDownCapture={interactionHandlers.onKeyDownCapture}
        onFocusCapture={interactionHandlers.onFocusCapture}
        onBlurCapture={(event) =>
          interactionHandlers.onBlurCapture(event, drawingActionsOverlayRef.current)
        }
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
          ref={interactionHandlers.mediaFileInputRef}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/tiff,image/svg+xml,video/mp4,video/quicktime,video/webm,.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp,.tif,.tiff,.svg,.mp4,.mov,.webm"
          aria-label="Choose image or video files"
          aria-hidden="true"
          tabIndex={-1}
          disabled={readOnly}
          onChange={interactionHandlers.onMediaFilesChange}
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
          onClearDrawingEditTarget={interactionHandlers.clearDrawingEditTarget}
          onEditMermaid={setMermaidDialogTarget}
          onCloseMermaid={() => setMermaidDialogTarget(null)}
          onReplaceMermaid={replaceCurrentMermaidBlock}
        />
      </div>
    );
  },
);
