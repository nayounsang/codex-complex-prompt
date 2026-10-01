import {
  forwardRef,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom';
import { Crepe } from '@milkdown/crepe';
import type { BlockEditFeatureConfig } from '@milkdown/crepe/feature/block-edit';
import { editorViewCtx, schemaCtx } from '@milkdown/kit/core';
import { createAttachmentImageUrl } from '../../../attachment-image-url.js';
import {
  hasMermaidRelevantMutations,
  hasRemovedMermaidPreviewCard,
} from './mermaid-preview-observer.js';
import {
  createMermaidPreviewTargets,
  haveSameMermaidPreviewTargets,
} from './mermaid-preview-targets.js';
import { MermaidDiagramCard, MermaidDiagramDialog } from './MermaidDiagramCard.js';
import type { MermaidDiagramTarget } from './MermaidDiagramCard.js';
import {
  getConfiguredAttachmentId,
  getMarkdownAttachmentId,
  getMarkdownAttachmentExtension,
} from '../../../shared/markdown/attachment-path.js';
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
  readonly onDraw?: () => void;
  readonly onImageFiles?: (files: readonly File[]) => void | Promise<void>;
  readonly onEditDrawing?: (id: string) => void;
  readonly onDeleteDrawing?: (id: string) => void;
  readonly onReady?: (root: HTMLDivElement) => void;
}

const crepeFeatures = {
  [Crepe.Feature.ImageBlock]: false,
};

const drawingIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 16.5 9.8-9.8a2.1 2.1 0 0 1 3 3L7 19.5 3.5 20.5 4 16.5Z"/><path d="m12.5 8 3 3"/></svg>';
const diagramIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="6" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1"/><path d="M10 6h4a3 3 0 0 1 3 3v6M7 9v6h7"/></svg>';
type BlockEditBuilder = Parameters<NonNullable<BlockEditFeatureConfig['buildMenu']>>[0];
type AdvancedMenuItem = Parameters<ReturnType<BlockEditBuilder['getGroup']>['addItem']>[1];
function addAdvancedMenuItem(builder: BlockEditBuilder, id: string, item: AdvancedMenuItem): void {
  builder.getGroup('advanced').addItem(id, item);
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
    const hoveredImageRef = useRef<HTMLImageElement | null>(null);
    const hoverRequestIdRef = useRef(0);
    const drawingAvailabilityRef = useRef(
      new Map<string, Promise<{ readonly exists: boolean; readonly editable: boolean }>>(),
    );
    const [drawingEditTarget, setDrawingEditTarget] = useState<DrawingEditTarget | null>(null);
    const [mermaidTargets, setMermaidTargets] = useState<MermaidDiagramTarget[]>([]);
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
          String(node.attrs['language']).toLowerCase() !== 'mermaid' ||
          node.textContent !== target.source
        )
          return;
        const replacement =
          source === undefined
            ? schema.nodes['paragraph']?.create()
            : schema.nodes['code_block']?.create(
                { ...node.attrs, language: 'mermaid' },
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
      const image = target.closest('img');
      if (image instanceof HTMLImageElement) handleDrawingImageHover(image);
    };
    const handleEditorKeyDownCapture = (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
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
            middleware: [offset(6), flip(), shift({ padding: 8 })],
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
    const receiveImageFiles = useEffectEvent((files: readonly File[]) => {
      void onImageFiles?.(files);
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
            addAdvancedMenuItem(builder, 'draw', {
              label: 'Draw',
              icon: drawingIcon,
              onRun: () => actions.onDraw?.(),
            });
            addAdvancedMenuItem(builder, 'diagram', {
              label: 'Diagram',
              icon: diagramIcon,
              onRun: () => {
                const editor = crepeRef.current?.editor;
                if (editor === undefined) return;
                editor.action((ctx) => {
                  const view = ctx.get(editorViewCtx);
                  const schema = ctx.get(schemaCtx);
                  const codeBlock = schema.nodes['code_block'];
                  if (codeBlock === undefined) return;
                  const block = codeBlock.create({ language: 'mermaid' });
                  const transaction = view.state.tr.replaceSelectionWith(block);
                  view.dispatch(transaction);
                  view.focus();
                });
              },
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
          const imageFiles = files.filter(
            (file) => file.type === '' || file.type.startsWith('image/'),
          );
          if (imageFiles.length === 0) return;
          event.preventDefault();
          event.stopPropagation();
          receiveImageFiles(imageFiles);
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
        let mermaidObserver: MutationObserver | undefined;
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
            syncMermaidPreviews(editorRoot);
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
          mermaidObserver?.disconnect();
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
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="m19 6-1 14H6L5 6" />
                  <path d="M10 11v5M14 11v5" />
                </svg>
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
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', `Drawing actions: ${image.alt.trim() || 'Drawing'}`);
    if (image.src !== url) image.src = url;
  }
}
