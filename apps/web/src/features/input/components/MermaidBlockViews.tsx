import { lazy, Suspense } from 'react';
import { MermaidPreviewErrorBoundary } from './MermaidPreviewErrorBoundary.js';
import type { MermaidPreviewTarget } from './mermaid-preview-targets.js';

const MermaidPreview = lazy(async () => {
  const module = await import('./MermaidSdkComponents.js');
  return { default: module.MermaidPreview };
});

// Milkdown owns the code editor outside the portal; this marker reveals that editor.
export function MermaidCodeView(): React.JSX.Element {
  return <span className="mermaid-code-view" aria-hidden="true" />;
}

interface MermaidDiagramViewProps {
  readonly target: MermaidPreviewTarget;
  readonly readOnly: boolean;
  readonly onEdit: (target: MermaidPreviewTarget) => void;
}

export function MermaidDiagramView({
  target,
  readOnly,
  onEdit,
}: MermaidDiagramViewProps): React.JSX.Element {
  return (
    <div className="mermaid-preview-open">
      <div className="mermaid-preview-content" aria-hidden="true">
        {target.source.trim() === '' ? (
          <span className="mermaid-preview-placeholder">Edit Your Diagram</span>
        ) : (
          <Suspense fallback={<span>Rendering diagram…</span>}>
            <MermaidPreviewErrorBoundary resetKey={target.source}>
              <MermaidPreview source={target.source} />
            </MermaidPreviewErrorBoundary>
          </Suspense>
        )}
      </div>
      <button
        type="button"
        className="mermaid-preview-trigger"
        aria-disabled="false"
        aria-label={
          readOnly
            ? 'Select diagram for feedback'
            : target.source.trim() === ''
              ? 'Edit Your Diagram'
              : 'Edit diagram'
        }
        onPointerDownCapture={(event) => event.stopPropagation()}
        onMouseDownCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClickCapture={(event) => {
          event.stopPropagation();
          if (readOnly) return;
          onEdit(target);
        }}
      />
    </div>
  );
}
