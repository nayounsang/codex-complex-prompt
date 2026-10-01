import { useEffect, useRef } from 'react';
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

interface SvgViewBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

function parseSvgViewBox(value: string | null): SvgViewBox | null {
  if (value === null) return null;

  const values = value.trim().split(/[ ,]+/).map(Number);
  if (!isValidSvgViewBox(values)) return null;

  const [minX, minY, width, height] = values;
  return { minX, minY, width, height };
}

function isValidSvgViewBox(
  values: readonly number[],
): values is readonly [number, number, number, number] {
  if (values.length !== 4) return false;

  const [minX, minY, width, height] = values;
  return (
    minX !== undefined &&
    minY !== undefined &&
    width !== undefined &&
    height !== undefined &&
    Number.isFinite(minX) &&
    Number.isFinite(minY) &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  );
}

export function MermaidPreview({ source }: MermaidPreviewProps): React.JSX.Element {
  const previewHostRef = useRef<HTMLDivElement>(null);

  useEffect(function fitCompactMermaidPreview() {
    const previewHost = previewHostRef.current;
    const stage = previewHost?.querySelector<HTMLDivElement>('.mve-preview-stage');
    const preview = previewHost?.querySelector<HTMLDivElement>('.mve-preview');
    if (stage === null || stage === undefined || preview === null || preview === undefined) return;

    const fitPreview = (): void => {
      const svg = preview.querySelector('svg');
      const viewBox = parseSvgViewBox(svg?.getAttribute('viewBox') ?? null);
      if (viewBox === null || stage.clientWidth <= 0 || stage.clientHeight <= 0) {
        return;
      }

      const zoom = Math.max(
        0.2,
        Math.min(
          3,
          (stage.clientWidth - 32) / viewBox.width,
          (stage.clientHeight - 32) / viewBox.height,
        ),
      );
      if (Math.abs(Number(preview.style.zoom) - zoom) < 0.001) return;
      preview.style.zoom = String(zoom);
      stage.scrollTo({ top: 0, left: 0 });
    };

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fitPreview);
    resizeObserver?.observe(stage);

    const mutationObserver = new MutationObserver(() => window.requestAnimationFrame(fitPreview));
    mutationObserver.observe(preview, {
      attributes: true,
      attributeFilter: ['style'],
      childList: true,
      subtree: true,
    });
    fitPreview();

    return () => {
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return (
    <div ref={previewHostRef} className="mermaid-preview-host">
      <MermaidEditor className="mermaid-preview-editor" value={source} onChange={() => undefined}>
        <MermaidCanvasOnly />
      </MermaidEditor>
    </div>
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
