import {
  DiagramTypeSelect,
  EditorShell,
  MermaidCanvas,
  MermaidEditor,
  SelectionEditor,
  SourceEditor,
  ToolSidebar,
  useMermaidEditorParts,
} from '@mermaid-editor-sdk/ui';
import '@mermaid-editor-sdk/ui/style.css';

import type { MermaidDiagramEditorProps } from '@codex-complex-prompt/milkdown-plugins/mermaid/ui';

export function MermaidDiagramEditor({
  source,
  view,
  onChange,
  onSave,
}: MermaidDiagramEditorProps): React.JSX.Element {
  return (
    <MermaidEditor
      className={`mermaid-dialog-sdk mermaid-dialog-sdk-${view}`}
      title="Diagram"
      value={source}
      onChange={onChange}
      onSave={onSave}
    >
      <MermaidDiagramEditorComposition view={view} />
    </MermaidEditor>
  );
}

function MermaidDiagramEditorComposition({
  view,
}: Pick<MermaidDiagramEditorProps, 'view'>): React.JSX.Element {
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
