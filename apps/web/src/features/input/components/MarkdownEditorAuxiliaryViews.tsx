import { lazy, Suspense, type RefObject } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import type { VideoEmbedTarget } from '../../../shared/markdown/video-embeds.js';
import { VideoEmbedPreview } from './VideoEmbedPreview.js';
import type { MermaidDiagramDialogProps } from '@codex-complex-prompt/milkdown-plugins/mermaid/ui';
import { MermaidPreviewErrorBoundary } from '@codex-complex-prompt/milkdown-plugins/mermaid/core';
import type { MermaidDiagramTarget } from '@codex-complex-prompt/milkdown-plugins/mermaid/core';
import type { DrawingEditTarget } from './markdown-editor-dom.js';

const MermaidDiagramCard = lazy(async () => {
  const [module] = await Promise.all([
    import('@codex-complex-prompt/milkdown-plugins/mermaid/ui'),
    import('@mermaid-editor-sdk/ui/style.css'),
  ]);
  return { default: module.MermaidDiagramCard };
});

const MermaidDiagramDialog = lazy(async () => {
  const [{ MermaidDiagramDialog }, { MermaidDiagramEditor }] = await Promise.all([
    import('@codex-complex-prompt/milkdown-plugins/mermaid/ui'),
    import('./MermaidDiagramEditor.js'),
  ]);
  return {
    default: function MermaidDiagramDialogWithEditor(
      props: Omit<MermaidDiagramDialogProps, 'Editor'>,
    ): React.JSX.Element {
      return <MermaidDiagramDialog {...props} Editor={MermaidDiagramEditor} />;
    },
  };
});

interface DrawingActions {
  readonly onEditDrawing: ((id: string) => void) | undefined;
  readonly onDeleteDrawing: ((id: string) => void) | undefined;
}

interface MarkdownEditorAuxiliaryViewsProps {
  readonly drawingActions: DrawingActions;
  readonly drawingActionsOverlayRef: RefObject<HTMLDivElement | null>;
  readonly drawingEditTarget: DrawingEditTarget | null;
  readonly drawingEditPosition: { readonly top: number; readonly left: number };
  readonly mermaidTargets: readonly MermaidDiagramTarget[];
  readonly videoTargets: readonly VideoEmbedTarget[];
  readonly mermaidDialogTarget: MermaidDiagramTarget | null;
  readonly readOnly: boolean;
  readonly onClearDrawingEditTarget: () => void;
  readonly onEditMermaid: (target: MermaidDiagramTarget) => void;
  readonly onCloseMermaid: () => void;
  readonly onReplaceMermaid: (target: MermaidDiagramTarget, source?: string) => boolean;
}

export function MarkdownEditorAuxiliaryViews({
  drawingActions,
  drawingActionsOverlayRef,
  drawingEditTarget,
  drawingEditPosition,
  mermaidTargets,
  videoTargets,
  mermaidDialogTarget,
  readOnly,
  onClearDrawingEditTarget,
  onEditMermaid,
  onCloseMermaid,
  onReplaceMermaid,
}: MarkdownEditorAuxiliaryViewsProps): React.JSX.Element {
  return (
    <>
      {drawingEditTarget !== null && !readOnly && (
        <div
          ref={drawingActionsOverlayRef}
          className="drawing-actions-overlay"
          style={drawingEditPosition}
        >
          {drawingEditTarget.editable && drawingActions.onEditDrawing !== undefined && (
            <button
              type="button"
              className="drawing-edit-overlay"
              aria-label="Edit drawing"
              title="Edit drawing"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => drawingActions.onEditDrawing?.(drawingEditTarget.id)}
            >
              <Pencil aria-hidden="true" size={18} />
            </button>
          )}
          {drawingActions.onDeleteDrawing !== undefined && (
            <button
              type="button"
              className="drawing-edit-overlay"
              aria-label="Delete drawing"
              title="Delete drawing"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                drawingActions.onDeleteDrawing?.(drawingEditTarget.id);
                onClearDrawingEditTarget();
              }}
            >
              <Trash2 aria-hidden="true" size={18} />
            </button>
          )}
        </div>
      )}
      {mermaidTargets.map((target) => (
        <Suspense key={target.id} fallback={<span role="status">Loading diagram…</span>}>
          <MermaidPreviewErrorBoundary resetKey={target.source}>
            <MermaidDiagramCard
              target={target}
              readOnly={readOnly}
              onEdit={onEditMermaid}
              onReplace={onReplaceMermaid}
            />
          </MermaidPreviewErrorBoundary>
        </Suspense>
      ))}
      {videoTargets.map((target) => (
        <VideoEmbedPreview key={`${target.id}:${target.source}`} target={target} />
      ))}
      {mermaidDialogTarget !== null && (
        <Suspense fallback={<span role="status">Loading diagram editor…</span>}>
          <MermaidDiagramDialog
            key={mermaidDialogTarget.id}
            target={mermaidDialogTarget}
            onClose={onCloseMermaid}
            onReplace={onReplaceMermaid}
          />
        </Suspense>
      )}
    </>
  );
}
