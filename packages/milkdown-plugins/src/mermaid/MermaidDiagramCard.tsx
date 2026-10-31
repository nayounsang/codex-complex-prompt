import { useState } from 'react';
import type { ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';

import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';
import { Tabs } from '@base-ui/react/tabs';
import { MermaidCodeView, MermaidDiagramView } from './MermaidBlockViews.js';
import type { MermaidPreviewTarget } from './preview-targets.js';
import { MERMAID_UI_REPLACEMENT_MODEL } from '../shared.js';

export type MermaidDiagramTarget = MermaidPreviewTarget;
type MermaidView = 'diagram' | 'code';
const mermaidViews: readonly MermaidView[] = ['diagram', 'code'];

export interface MermaidDiagramEditorProps {
  readonly source: string;
  readonly view: 'canvas' | 'code';
  readonly onChange: (source: string) => void;
  readonly onSave: (source: string) => void;
}

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
  const [view, setView] = useState<MermaidView>('diagram');
  return createPortal(
    <Tabs.Root
      className="mermaid-preview-card"
      value={view}
      onValueChange={(value: unknown) => {
        if (value === 'diagram' || value === 'code') setView(value);
      }}
      data-markdown-ui-replacement={MERMAID_UI_REPLACEMENT_MODEL.kind}
    >
      <div className="mermaid-view-header">
        <Tabs.List className="mermaid-view-tabs" aria-label="Diagram view" aria-disabled="false">
          {mermaidViews.map((tab) => (
            <Tabs.Tab key={tab} value={tab}>
              {tab}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {!readOnly && (
          <button
            type="button"
            className="mermaid-delete-button"
            aria-label="Delete diagram"
            title="Delete diagram"
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              onReplace(target);
            }}
          >
            <Trash2 aria-hidden="true" size={18} />
          </button>
        )}
      </div>
      <Tabs.Panel value="diagram">
        <MermaidDiagramView target={target} readOnly={readOnly} onEdit={onEdit} />
      </Tabs.Panel>
      <Tabs.Panel value="code" aria-owns={`${target.id}-code-editor`}>
        <MermaidCodeView />
      </Tabs.Panel>
    </Tabs.Root>,
    target.mount,
  );
}

export interface MermaidDiagramDialogProps {
  readonly Editor: ComponentType<MermaidDiagramEditorProps>;
  readonly target: MermaidDiagramTarget;
  readonly onClose: () => void;
  readonly onReplace: (target: MermaidDiagramTarget, source?: string) => boolean;
}

export function MermaidDiagramDialog({
  Editor,
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
            <Editor source={editSource} view={view} onChange={setEditSource} onSave={save} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
