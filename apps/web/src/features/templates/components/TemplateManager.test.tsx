import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PromptTemplate } from '@codex-complex-prompt/protocol';

import { TemplateManager } from './TemplateManager.js';

beforeEach(() => {
  vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000001' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

interface RenderOptions {
  readonly templates?: readonly PromptTemplate[];
  readonly templatesError?: string | null;
  readonly markdown?: string;
  readonly onApply?: (body: string) => void;
  readonly onSave?: (template: PromptTemplate) => Promise<{
    status: 'accepted' | 'failed';
    templates?: readonly PromptTemplate[];
    error?: string;
  }>;
  readonly onDelete?: (id: string) => Promise<{
    status: 'accepted' | 'failed';
    templates?: readonly PromptTemplate[];
    error?: string;
  }>;
}

function renderTemplateManager(options: RenderOptions = {}): void {
  render(
    <TemplateManager
      templates={options.templates ?? []}
      templatesError={options.templatesError ?? null}
      markdown={options.markdown ?? ''}
      isDisabled={false}
      onApply={options.onApply ?? vi.fn()}
      onSave={
        options.onSave ?? (async (template) => ({ status: 'accepted', templates: [template] }))
      }
      onDelete={options.onDelete ?? (async () => ({ status: 'accepted', templates: [] }))}
    />,
  );
}

describe('프로젝트 템플릿 관리자', () => {
  it('만들기를 선택하면 빈 템플릿 편집기를 연다', async () => {
    renderTemplateManager();

    fireEvent.click(screen.getByRole('combobox', { name: 'Project template' }));
    fireEvent.click(await screen.findByRole('option', { name: /Create your first template/ }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Create template');
    expect(screen.getByRole('textbox', { name: 'Markdown body' })).toHaveValue('');
  });

  it('템플릿을 사용할 수 없으면 이유를 표시하고 선택을 비활성화한다', () => {
    renderTemplateManager({ templatesError: '프로젝트 경로를 사용할 수 없습니다.' });

    expect(screen.getByRole('combobox', { name: 'Project template' })).toBeDisabled();
    expect(screen.getByText('프로젝트 경로를 사용할 수 없습니다.')).toBeVisible();
  });

  it('이름이 제한보다 길면 저장하지 않고 오류를 표시한다', async () => {
    const onSave = vi.fn(async (template: PromptTemplate) => ({
      status: 'accepted' as const,
      templates: [template],
    }));
    renderTemplateManager({ onSave });

    fireEvent.click(screen.getByRole('combobox', { name: 'Project template' }));
    fireEvent.click(await screen.findByRole('option', { name: /Create your first template/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: '이름'.repeat(61) },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: '설명' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('1–120 characters');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('설명이 제한보다 길면 저장하지 않고 오류를 표시한다', async () => {
    const onSave = vi.fn(async (template: PromptTemplate) => ({
      status: 'accepted' as const,
      templates: [template],
    }));
    renderTemplateManager({ onSave });

    fireEvent.click(screen.getByRole('combobox', { name: 'Project template' }));
    fireEvent.click(await screen.findByRole('option', { name: /Create your first template/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: '유효한 이름' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: '설명'.repeat(251) },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('500 characters or fewer');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('본문이 프롬프트 제한보다 길면 저장하지 않고 오류를 표시한다', async () => {
    const onSave = vi.fn(async (template: PromptTemplate) => ({
      status: 'accepted' as const,
      templates: [template],
    }));
    renderTemplateManager({ onSave });

    fireEvent.click(screen.getByRole('combobox', { name: 'Project template' }));
    fireEvent.click(await screen.findByRole('option', { name: /Create your first template/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: '유효한 이름' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown body' }), {
      target: { value: '가'.repeat(12_001) },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Markdown body must be 12,000');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('선택되지 않은 항목에서 수정을 누르면 해당 템플릿을 편집한다', async () => {
    renderTemplateManager({
      templates: [
        {
          id: 'template-1',
          name: '수정할 템플릿',
          description: '기존 설명',
          body: '기존 본문',
        },
      ],
    });

    fireEvent.click(screen.getByRole('combobox', { name: 'Project template' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit 수정할 템플릿' }));

    expect(screen.getByRole('dialog')).toHaveTextContent('Edit template');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('수정할 템플릿');
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('기존 설명');
    expect(screen.getByRole('textbox', { name: 'Markdown body' })).toHaveValue('기존 본문');
  });

  it('편집기가 비어 있으면 선택한 템플릿 본문을 적용한다', async () => {
    const onApply = vi.fn();
    renderTemplateManager({
      onApply,
      templates: [
        {
          id: 'template-1',
          name: '작업 템플릿',
          description: '짧은 설명',
          body: '# 작업 지시',
        },
      ],
    });

    fireEvent.click(screen.getByRole('combobox', { name: 'Project template' }));
    fireEvent.click(await screen.findByRole('option', { name: /작업 템플릿/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith('# 작업 지시');
  });

  it('기존 문서를 덮어쓰기 전에 확인을 요청한다', async () => {
    const onApply = vi.fn();
    renderTemplateManager({
      markdown: '현재 문서',
      onApply,
      templates: [
        {
          id: 'template-1',
          name: '새 명령',
          description: '설명',
          body: '새 본문',
        },
      ],
    });

    fireEvent.click(screen.getByRole('combobox', { name: 'Project template' }));
    fireEvent.click(await screen.findByRole('option', { name: /새 명령/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent('새 명령');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('삭제 확인에서 취소하면 템플릿을 삭제하지 않는다', async () => {
    const onDelete = vi.fn(async () => ({ status: 'accepted' as const, templates: [] }));
    renderTemplateManager({
      onDelete,
      templates: [
        {
          id: 'template-1',
          name: '삭제할 템플릿',
          description: '설명',
          body: '본문',
        },
      ],
    });

    fireEvent.click(screen.getByRole('combobox', { name: 'Project template' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 삭제할 템플릿' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('삭제할 템플릿');
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(onDelete).not.toHaveBeenCalled();
  });
});
