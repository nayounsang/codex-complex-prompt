import {
  EditorStatus,
  EditorShell,
  DiagramTypeSelect,
  MermaidCanvas,
  MermaidEditor,
  SelectionEditor,
  SourceEditor,
  ToolSidebar,
  useMermaidEditorParts,
} from '@mermaid-editor-sdk/ui';
import '@mermaid-editor-sdk/ui/style.css';

interface MermaidPreviewProps {
  readonly source: string;
}

interface MermaidDialogEditorProps {
  readonly source: string;
  readonly view: 'canvas' | 'code';
  readonly onChange: (source: string) => void;
  readonly onSave: (source: string) => void;
}

export function MermaidPreview({ source }: MermaidPreviewProps): React.JSX.Element {
  return (
    <MermaidEditor className="mermaid-preview-editor" value={source} onChange={() => undefined}>
      <MermaidCanvasOnly />
    </MermaidEditor>
  );
}

export function MermaidDialogEditor({
  source,
  view,
  onChange,
  onSave,
}: MermaidDialogEditorProps): React.JSX.Element {
  return (
    <MermaidEditor
      className={`mermaid-dialog-sdk mermaid-dialog-sdk-${view}`}
      title="Diagram"
      value={source}
      onChange={onChange}
      onSave={onSave}
    >
      <MermaidDialogComposition view={view} />
    </MermaidEditor>
  );
}

function MermaidDialogComposition({
  view,
}: Pick<MermaidDialogEditorProps, 'view'>): React.JSX.Element {
  const parts = useMermaidEditorParts();
  return (
    <EditorShell {...parts.shell}>
      {view === 'canvas' && (
        <>
          <EditorShell.Sidebar>
            <ToolSidebar {...parts.toolbar} />
          </EditorShell.Sidebar>
          <EditorShell.HeaderControls>
            <DiagramTypeSelect {...parts.diagramTypeSelect} />
          </EditorShell.HeaderControls>
          <EditorShell.Canvas>
            <MermaidCanvas {...parts.canvas} />
          </EditorShell.Canvas>
          <EditorShell.Selection>
            <SelectionEditor {...parts.selectionEditor} />
          </EditorShell.Selection>
        </>
      )}
      {view === 'code' && (
        <EditorShell.Source>
          <SourceEditor {...parts.sourceEditor} />
        </EditorShell.Source>
      )}
    </EditorShell>
  );
}

function MermaidCanvasOnly(): React.JSX.Element {
  const parts = useMermaidEditorParts();
  return (
    <EditorShell {...parts.shell}>
      <EditorShell.Canvas>
        <MermaidCanvas {...parts.canvas} />
      </EditorShell.Canvas>
      <EditorShell.Status>
        <EditorStatus {...parts.status} />
      </EditorShell.Status>
    </EditorShell>
  );
}
