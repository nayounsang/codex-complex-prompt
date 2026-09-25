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

    expect(screen.getByRole('alert')).toHaveTextContent('그림 편집 데이터를 열지 못했습니다');
    expect(screen.getByRole('button', { name: '삽입' })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
