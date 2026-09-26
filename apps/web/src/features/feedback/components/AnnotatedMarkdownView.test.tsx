import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../shared/testing/mock-crepe.js';
import { hasRenderedSourceMap } from '../../../shared/markdown/markdown-source-map.js';
import { AnnotatedMarkdownView } from './AnnotatedMarkdownView.js';

afterEach(() => cleanup());

function renderMarkdown(
  markdown: string,
  onSelection = vi.fn(),
  annotations: Parameters<typeof AnnotatedMarkdownView>[0]['annotations'] = [],
): HTMLElement {
  render(
    <AnnotatedMarkdownView
      markdown={markdown}
      attachmentUrl="http://127.0.0.1:8765/_complex-prompt/attachments"
      attachmentToken="test-token"
      attachmentRefreshKey={0}
      annotations={annotations}
      selectionPopoverOpen={false}
      onSelection={onSelection}
    />,
  );
  return screen.getByTestId('annotated-markdown');
}

describe('AnnotatedMarkdownView', () => {
  it('렌더링된 Markdown에서 텍스트 선택의 원문 범위를 전달한다', async () => {
    const onSelection = vi.fn();
    const article = renderMarkdown('Review this sentence', onSelection);
    await waitFor(() => expect(hasRenderedSourceMap(article)).toBe(true));
    const textNode = await waitFor(() => {
      const node = article.querySelector('p')?.firstChild;
      expect(node).toBeInstanceOf(Text);
      return node as Text;
    });
    const range = document.createRange();
    range.setStart(textNode, 7);
    range.setEnd(textNode, 11);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.mouseDown(article);
    fireEvent.mouseUp(article);

    expect(onSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({ quote: 'this', start: 7, end: 11 }),
    );
  });

  it('읽기 전용 그림을 눌러 그림 피드백 선택으로 만든다', async () => {
    const onSelection = vi.fn();
    const markdown =
      '![다이어그램](.complex-prompt/attachments/00000000-0000-4000-8000-000000000001.png)';
    const article = renderMarkdown(markdown, onSelection);
    const image = await within(article).findByRole('button', {
      name: 'Select image for feedback: 다이어그램 (.complex-prompt/attachments/00000000-0000-4000-8000-000000000001.png)',
    });

    fireEvent.click(image);

    expect(article.querySelector('[contenteditable="false"]')).not.toBeNull();
    expect(onSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({ quote: markdown, start: 0, end: markdown.length }),
    );
  });

  it('키보드 Enter로 읽기 전용 그림을 피드백 대상으로 선택한다', async () => {
    const onSelection = vi.fn();
    const markdown =
      '![화면](.complex-prompt/attachments/00000000-0000-4000-8000-000000000002.png)';
    const article = renderMarkdown(markdown, onSelection);
    const image = await within(article).findByRole('button', {
      name: 'Select image for feedback: 화면 (.complex-prompt/attachments/00000000-0000-4000-8000-000000000002.png)',
    });

    fireEvent.keyDown(image, { key: 'Enter' });

    expect(onSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({ quote: markdown, start: 0, end: markdown.length }),
    );
  });

  it('같은 이름의 그림이 여러 개여도 선택한 파일 경로를 피드백 대상으로 연결한다', async () => {
    const onSelection = vi.fn();
    const first =
      '![Drawing](.complex-prompt/attachments/00000000-0000-4000-8000-000000000004.png)';
    const second =
      '![Drawing](.complex-prompt/attachments/00000000-0000-4000-8000-000000000005.png)';
    const markdown = `${first}\n\n${second}`;
    const article = renderMarkdown(markdown, onSelection);
    const secondImage = await within(article).findByRole('button', {
      name: 'Select image for feedback: Drawing (.complex-prompt/attachments/00000000-0000-4000-8000-000000000005.png)',
    });

    fireEvent.click(secondImage);

    expect(onSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        quote: second,
        start: markdown.indexOf(second),
        end: markdown.indexOf(second) + second.length,
      }),
    );
  });

  it('그림의 Markdown 원문 범위와 겹치는 기존 피드백을 강조한다', async () => {
    const markdown =
      '![와이어프레임](.complex-prompt/attachments/00000000-0000-4000-8000-000000000003.png)';
    const article = renderMarkdown(markdown, vi.fn(), [
      {
        id: 'drawing-feedback',
        scope: 'selection',
        quote: markdown,
        start: 0,
        end: markdown.length,
        feedback: '이 그림을 수정해 주세요.',
      },
    ]);
    const image = await within(article).findByRole('button', {
      name: 'Select image for feedback: 와이어프레임 (.complex-prompt/attachments/00000000-0000-4000-8000-000000000003.png)',
    });

    await waitFor(() => expect(image).toHaveClass('feedback-image-highlight'));
  });

  it('task list checkbox를 비활성 상태로 표시한다', async () => {
    const article = renderMarkdown('- [x] Run the tests');
    await waitFor(() => expect(article.querySelector('input[type="checkbox"]')).not.toBeNull());

    expect(article.querySelector('input[type="checkbox"]')).toBeDisabled();
    expect(article).toHaveTextContent('Run the tests');
  });

  it('Markdown link를 anchor로 표시한다', async () => {
    const article = renderMarkdown('[Milkdown](https://milkdown.dev)');

    expect(await within(article).findByRole('link', { name: 'Milkdown' })).toHaveAttribute(
      'href',
      'https://milkdown.dev',
    );
  });

  it('fenced code와 table을 의미 있는 문서 구조로 표시한다', async () => {
    const article = renderMarkdown(
      '```ts\nconst answer = 42;\n```\n\n| Name | Value |\n| --- | --- |\n| mode | feedback |',
    );
    await waitFor(() => expect(article.querySelector('pre')).not.toBeNull());

    expect(article.querySelector('pre')).toHaveTextContent('const answer = 42;');
    expect(article.querySelectorAll('th')).toHaveLength(2);
    expect(article.querySelectorAll('td')).toHaveLength(2);
    expect(article.querySelector('table')).toHaveTextContent('feedback');
  });
});
