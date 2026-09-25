import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../shared/testing/mock-crepe.js';
import { hasRenderedSourceMap } from '../../../shared/markdown/markdown-source-map.js';
import { AnnotatedMarkdownView } from './AnnotatedMarkdownView.js';

afterEach(() => cleanup());

function renderMarkdown(markdown: string, onSelection = vi.fn()): HTMLElement {
  render(
    <AnnotatedMarkdownView
      markdown={markdown}
      attachmentUrl={null}
      attachmentToken={null}
      attachmentRefreshKey={0}
      annotations={[]}
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
