import {
  EditorStatus,
  EditorShell,
  MermaidCanvas,
  MermaidEditor,
  useMermaidEditorParts,
} from '@mermaid-editor-sdk/ui';

interface MermaidPreviewProps {
  readonly source: string;
}

export function MermaidPreview({ source }: MermaidPreviewProps): React.JSX.Element {
  return (
    <div className="mermaid-preview-host">
      <MermaidEditor
        className="mermaid-preview-editor"
        value={source}
        onChange={() => undefined}
        autoFit
      >
        <MermaidCanvasOnly />
      </MermaidEditor>
    </div>
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
