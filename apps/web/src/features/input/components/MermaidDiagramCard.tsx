import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';
import { MermaidPreviewErrorBoundary } from './MermaidPreviewErrorBoundary.js';
import type { MermaidPreviewTarget } from './mermaid-preview-targets.js';
import { MARKDOWN_UI_REPLACEMENT_MODEL } from '../../../shared/markdown/ui-replacements.js';

const MermaidPreview = lazy(async () => {
  const module = await import('./MermaidSdkComponents.js');
  return { default: module.MermaidPreview };
});
const MermaidDialogEditor = lazy(async () => {
  const module = await import('./MermaidSdkComponents.js');
  return { default: module.MermaidDialogEditor };
});

export type MermaidDiagramTarget = MermaidPreviewTarget;

interface MermaidDiagramCardProps {
  readonly target: MermaidDiagramTarget;
  readonly readOnly: boolean;
  readonly onEdit: (target: MermaidDiagramTarget) => void;
  readonly onReplace: (target: MermaidDiagramTarget, source?: string) => boolean;
}

export function MermaidDiagramCard({
  target,
  readOnly,
  onEdit,
  onReplace,
}: MermaidDiagramCardProps): React.JSX.Element {
  return createPortal(
    <div
      className="mermaid-preview-card"
      data-markdown-ui-replacement={MARKDOWN_UI_REPLACEMENT_MODEL.mermaid.kind}
    >
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
          aria-label={target.source.trim() === '' ? 'Edit Your Diagram' : 'Edit diagram'}
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
      {!readOnly && (
        <div className="mermaid-preview-actions-overlay">
          <button
            type="button"
            className="drawing-edit-overlay"
            aria-label="Delete diagram"
            title="Delete diagram"
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              onReplace(target);
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
        </div>
      )}
    </div>,
    target.mount,
  );
}

interface MermaidDiagramDialogProps {
  readonly target: MermaidDiagramTarget;
  readonly onClose: () => void;
  readonly onReplace: (target: MermaidDiagramTarget, source?: string) => boolean;
}

export function MermaidDiagramDialog({
  target,
  onClose,
  onReplace,
}: MermaidDiagramDialogProps): React.JSX.Element {
  const [editSource, setEditSource] = useState(
    target.source.trim() === '' ? 'flowchart TD\n' : target.source,
  );
  const [view, setView] = useState<'canvas' | 'code'>('canvas');
  const [saveError, setSaveError] = useState<string | null>(null);
  const save = (source: string): void => {
    if (onReplace(target, source)) {
      onClose();
      return;
    }
    setSaveError(
      'This diagram changed while the editor was open. Close and reopen it before saving.',
    );
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className="mermaid-editor-dialog">
          <div className="mermaid-editor-dialog-header">
            <Dialog.Title>Edit diagram</Dialog.Title>
            <div
              className="mermaid-editor-dialog-tabs"
              role="tablist"
              aria-label="Diagram editor view"
            >
              <button
                type="button"
                role="tab"
                id="mermaid-editor-canvas-tab"
                aria-selected={view === 'canvas'}
                aria-controls="mermaid-editor-panel"
                onClick={() => setView('canvas')}
              >
                Canvas
              </button>
              <button
                type="button"
                role="tab"
                id="mermaid-editor-code-tab"
                aria-selected={view === 'code'}
                aria-controls="mermaid-editor-panel"
                onClick={() => setView('code')}
              >
                Mermaid code
              </button>
            </div>
            {view === 'code' && (
              <Button type="button" className="button-primary" onClick={() => save(editSource)}>
                Save
              </Button>
            )}
            <Button type="button" className="button-secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
          {saveError !== null && <p role="alert">{saveError}</p>}
          <div
            id="mermaid-editor-panel"
            className="mermaid-editor-dialog-panel"
            role="tabpanel"
            aria-labelledby={
              view === 'canvas' ? 'mermaid-editor-canvas-tab' : 'mermaid-editor-code-tab'
            }
          >
            <Suspense fallback={<p>Loading diagram editor…</p>}>
              <MermaidDialogEditor
                source={editSource}
                view={view}
                onChange={setEditSource}
                onSave={save}
              />
            </Suspense>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
