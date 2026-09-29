import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MermaidPreviewErrorBoundary } from './MermaidPreviewErrorBoundary.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function BrokenDiagram(): React.JSX.Element {
  throw new Error('Diagram render failed');
}

describe('MermaidPreviewErrorBoundary', () => {
  it('한 다이어그램 미리보기가 실패해도 다른 다이어그램을 표시한다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <>
        <MermaidPreviewErrorBoundary resetKey="broken">
          <BrokenDiagram />
        </MermaidPreviewErrorBoundary>
        <MermaidPreviewErrorBoundary resetKey="healthy">
          <span>Healthy diagram</span>
        </MermaidPreviewErrorBoundary>
      </>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Diagram preview unavailable');
    expect(screen.getByText('Healthy diagram')).toBeInTheDocument();
  });

  it('다이어그램 소스가 바뀌면 실패한 미리보기에서 다시 렌더링한다', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(
      <MermaidPreviewErrorBoundary resetKey="broken">
        <BrokenDiagram />
      </MermaidPreviewErrorBoundary>,
    );

    rerender(
      <MermaidPreviewErrorBoundary resetKey="repaired">
        <span>Repaired diagram</span>
      </MermaidPreviewErrorBoundary>,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Repaired diagram')).toBeInTheDocument();
  });
});
