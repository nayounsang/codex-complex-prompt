import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MermaidDiagramCard,
  MermaidDiagramDialog,
  type MermaidDiagramTarget,
} from './MermaidDiagramCard.js';

vi.mock('./MermaidSdkComponents.js', () => ({
  MermaidPreview: ({ source }: { readonly source: string }) => (
    <div>
      <button type="button" aria-label="SDK canvas control">
        {source}
      </button>
    </div>
  ),
  MermaidDialogEditor: ({
    source,
    view,
    onChange,
    onSave,
  }: {
    readonly source: string;
    readonly view: 'canvas' | 'code';
    readonly onChange: (source: string) => void;
    readonly onSave: (source: string) => void;
  }) => (
    <div data-testid="sdk-editor" data-view={view}>
      <output>{source}</output>
      {view === 'code' && (
        <textarea
          aria-label="Mermaid code"
          value={source}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
      <button type="button" onClick={() => onSave(source)}>
        SDK Save
      </button>
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function createTarget(id: string, source: string): MermaidDiagramTarget {
  const block = document.createElement('pre');
  block.className = 'milkdown-code-block';
  const mount = document.createElement('div');
  mount.className = 'mermaid-preview-mount';
  block.append(mount);
  document.body.append(block);
  return { id, block, mount, source, position: 0 };
}

describe('MermaidDiagramCard', () => {
  it('미리보기의 편집 버튼 클릭을 상위 편집 상태에 전달한다', async () => {
    const target = createTarget('diagram-a', 'graph TD\n  A-->B');
    const onEdit = vi.fn();
    render(
      <MermaidDiagramCard target={target} readOnly={false} onEdit={onEdit} onReplace={vi.fn()} />,
    );

    const preview = await screen.findByRole('button', { name: 'Edit diagram' });
    await waitFor(() =>
      expect(
        target.mount.querySelector<HTMLButtonElement>('.mermaid-preview-content button'),
      ).not.toBeNull(),
    );
    const sdkControl = target.mount.querySelector<HTMLButtonElement>(
      '.mermaid-preview-content button',
    );
    expect(sdkControl).toBeInTheDocument();
    expect(preview).not.toContainElement(sdkControl);
    fireEvent.click(preview);

    expect(onEdit).toHaveBeenCalledExactlyOnceWith(target);
  });

  it('빈 Mermaid 블록을 flowchart 기본값으로 편집한다', async () => {
    const target = createTarget('diagram-a', '');
    const onReplace = vi.fn(() => true);
    const onClose = vi.fn();
    render(<MermaidDiagramDialog target={target} onClose={onClose} onReplace={onReplace} />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    const source = await screen
      .findByTestId('sdk-editor')
      .then((editor) => editor.querySelector('output'));
    expect(source).toHaveTextContent('flowchart TD');
    expect(onReplace).not.toHaveBeenCalled();
  });

  it('삭제 아이콘을 누르면 해당 Mermaid 블록을 삭제한다', () => {
    const target = createTarget('diagram-delete', 'flowchart TD\n  A-->B');
    const onReplace = vi.fn();
    render(
      <MermaidDiagramCard
        target={target}
        readOnly={false}
        onEdit={vi.fn()}
        onReplace={onReplace}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete diagram' }));

    expect(onReplace).toHaveBeenCalledExactlyOnceWith(target);
  });

  it('Mermaid code 탭에서 수정한 소스를 저장한다', async () => {
    const target = createTarget('diagram-code-tab', 'flowchart TD\n  A-->B');
    const onReplace = vi.fn(() => true);
    const onClose = vi.fn();
    render(<MermaidDiagramDialog target={target} onClose={onClose} onReplace={onReplace} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Mermaid code' }));
    const editor = await screen.findByTestId('sdk-editor');
    expect(editor).toHaveAttribute('data-view', 'code');
    fireEvent.change(screen.getByRole('textbox', { name: 'Mermaid code' }), {
      target: { value: 'flowchart TD\n  A-->C' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onReplace).toHaveBeenCalledExactlyOnceWith(target, 'flowchart TD\n  A-->C');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('대상 변경으로 저장에 실패하면 다이얼로그를 열어 두고 안내를 표시한다', async () => {
    const target = createTarget('diagram-stale', 'flowchart TD\n  A-->B');
    const onReplace = vi.fn(() => false);
    const onClose = vi.fn();
    render(<MermaidDiagramDialog target={target} onClose={onClose} onReplace={onReplace} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Mermaid code' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This diagram changed while the editor was open.',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel 후 편집 버튼을 다시 누르면 다이얼로그를 다시 연다', async () => {
    const secondTarget = createTarget('diagram-b', 'sequenceDiagram\n  A->>B: Hi');
    const onReplace = vi.fn();
    function Harness(): React.JSX.Element {
      const [dialogTarget, setDialogTarget] = useState<MermaidDiagramTarget | null>(null);
      return (
        <>
          <MermaidDiagramCard
            target={secondTarget}
            readOnly={false}
            onEdit={setDialogTarget}
            onReplace={onReplace}
          />
          {dialogTarget !== null && (
            <MermaidDiagramDialog
              key={dialogTarget.id}
              target={dialogTarget}
              onClose={() => setDialogTarget(null)}
              onReplace={onReplace}
            />
          )}
        </>
      );
    }
    render(<Harness />);

    fireEvent.click(await screen.findByRole('button', { name: 'Edit diagram' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(await screen.findByRole('button', { name: 'Edit diagram' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
