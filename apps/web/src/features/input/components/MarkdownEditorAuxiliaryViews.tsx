import type { RefObject } from 'react';

import { SvgIcon } from '../../../shared/icons/SvgIcon.js';
import type { VideoEmbedTarget } from '../../../shared/markdown/video-embeds.js';
import { VideoEmbedPreview } from './VideoEmbedPreview.js';
import { MermaidDiagramCard, MermaidDiagramDialog } from './MermaidDiagramCard.js';
import type { MermaidDiagramTarget } from './MermaidDiagramCard.js';
import type { DrawingEditTarget } from './markdown-editor-dom.js';

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
              <SvgIcon name="pencil" />
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
          onEdit={onEditMermaid}
          onReplace={onReplaceMermaid}
        />
      ))}
      {videoTargets.map((target) => (
        <VideoEmbedPreview key={`${target.id}:${target.source}`} target={target} />
      ))}
      {mermaidDialogTarget !== null && (
        <MermaidDiagramDialog
          key={mermaidDialogTarget.id}
          target={mermaidDialogTarget}
          onClose={onCloseMermaid}
          onReplace={onReplaceMermaid}
        />
      )}
    </>
  );
}
