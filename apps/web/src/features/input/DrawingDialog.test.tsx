import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: () => null,
  exportToBlob: vi.fn(),
  FONT_FAMILY: { Excalifont: 1 },
}));

import { DrawingDialog } from './DrawingDialog.js';

describe('그림 편집 대화상자', () => {
  it('편집 데이터 JSON을 읽지 못하면 오류를 표시하고 빈 그림 저장을 막는다', () => {
    const onSave = vi.fn(async () => undefined);

    render(
      <DrawingDialog
        open
        attachmentId="00000000-0000-4000-8000-000000000011"
        initialScene="{"
        onSave={onSave}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not open the drawing data');
    expect(screen.getByRole('button', { name: 'Insert' })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Excalidraw가 허용하는 null appState 장면을 연다', () => {
    render(
      <DrawingDialog
        open
        attachmentId="00000000-0000-4000-8000-000000000012"
        initialScene='{"elements":[],"appState":null}'
        onSave={vi.fn(async () => undefined)}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Insert' })).toBeEnabled();
  });
});
