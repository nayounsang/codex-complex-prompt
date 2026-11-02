import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../shared/testing/mock-crepe.js';
import { hasRenderedSourceMap } from '../../../shared/markdown/markdown-source-map.js';
import { INERT_MEDIA_IMAGE_SRC } from '../../../shared/markdown/media-embeds.js';
import { AnnotatedMarkdownView } from './AnnotatedMarkdownView.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderMarkdown(
  markdown: string,
  onSelection = vi.fn(),
  annotations: Parameters<typeof AnnotatedMarkdownView>[0]['annotations'] = [],
  mediaResponse?: Response,
): HTMLElement {
  vi.stubGlobal('fetch', (input: RequestInfo | URL): Promise<Response> => {
    if (mediaResponse !== undefined) return Promise.resolve(mediaResponse);
    const requestUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const pathname = new URL(requestUrl, window.location.href).pathname;
    const extension = pathname.split('.').pop()?.toLowerCase() ?? '';
    const mimeType =
      extension === 'mp4'
        ? 'video/mp4'
        : extension === 'mov'
          ? 'video/quicktime'
          : extension === 'webm'
            ? 'video/webm'
            : 'image/png';
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': mimeType }),
    } as Response);
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(12, 24, 320, 180),
  );
  render(
    <AnnotatedMarkdownView
      markdown={markdown}
      attachmentUrl="http://127.0.0.1:8765/_complex-prompt/attachments"
      attachmentToken="test-token"
      attachmentRefreshKey={0}
      annotations={annotations}
      pendingSelection={null}
      onSelection={onSelection}
    />,
  );
  return screen.getByTestId('annotated-markdown');
}

async function loadSourceImages(article: HTMLElement): Promise<void> {
  let images: HTMLImageElement[] = [];
  await waitFor(() => {
    images = Array.from(
      article.querySelectorAll<HTMLImageElement>('.ProseMirror img[data-media-source]'),
    );
    expect(images.length).toBeGreaterThan(0);
    expect(images.every((image) => image.getAttribute('src') !== INERT_MEDIA_IMAGE_SRC)).toBe(true);
  });
  images.forEach((image) => fireEvent.load(image));
}

describe('AnnotatedMarkdownView', () => {
  it('renders Markdown images through the shared media renderer and shows its error state', async () => {
    const article = renderMarkdown('![Outside](https://example.test/photo.PNG?size=2#preview)');
    const image = await waitFor(() => {
      const rendered = article.querySelector<HTMLImageElement>('.media-embed-frame img');
      expect(rendered).not.toBeNull();
      return rendered as HTMLImageElement;
    });

    expect(image).toHaveAttribute('alt', 'Outside');
    expect(image).toHaveAttribute('src', 'https://example.test/photo.PNG?size=2#preview');
    fireEvent.error(image);

    await waitFor(() =>
      expect(article.querySelector('.media-embed-status')).toHaveTextContent('Media unavailable'),
    );
  });

  it('shows an error when the HEAD response has no MIME type', async () => {
    const article = renderMarkdown(
      '![Outside](https://example.test/photo)',
      undefined,
      [],
      new Response(null, { status: 200 }),
    );

    await waitFor(() =>
      expect(article.querySelector('.media-embed-status')).toHaveTextContent('Media unavailable'),
    );
    expect(article.querySelector('.media-embed-frame img, .media-embed-frame video')).toBeNull();
  });

  it('resolves an attachment image before passing its path to the shared renderer', async () => {
    const id = '00000000-0000-4000-8000-000000000006';
    const article = renderMarkdown(`![Drawing](.complex-prompt/attachments/${id}.png)`);

    const image = await waitFor(() => {
      const rendered = article.querySelector<HTMLImageElement>('.media-embed-frame img');
      expect(rendered).not.toBeNull();
      return rendered as HTMLImageElement;
    });

    expect(image.src).toContain(
      `/_complex-prompt/attachments/${id}.png?token=test-token&refresh=0`,
    );
  });

  it('renders a Markdown video through the shared renderer with controls', async () => {
    const article = renderMarkdown('![](https://example.test/clip.mp4?download=1#t=2)');

    const video = await waitFor(() => {
      const rendered = article.querySelector<HTMLVideoElement>('.media-embed-frame video');
      expect(rendered).not.toBeNull();
      return rendered as HTMLVideoElement;
    });

    expect(video).toHaveAttribute('src', 'https://example.test/clip.mp4?download=1#t=2');
    expect(video).toHaveAttribute('controls');
  });

  it('renders a disabled Add media button for an empty Markdown destination', async () => {
    const article = renderMarkdown('![]()');

    const button = await waitFor(() => within(article).getByRole('button', { name: 'Add media' }));

    expect(button).toHaveTextContent('Add media');
    expect(button).toBeDisabled();
    expect(article).not.toHaveTextContent('Media unavailable');
  });

  it('다이어그램 탭을 눌러도 이전 텍스트 선택을 다시 열지 않는다', async () => {
    const onSelection = vi.fn();
    const article = renderMarkdown('Review this sentence', onSelection);
    await waitFor(() => expect(hasRenderedSourceMap(article)).toBe(true), { timeout: 5_000 });
    const text = article.querySelector('p')?.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 6);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    const tabs = document.createElement('div');
    tabs.className = 'mermaid-view-tabs';
    const button = document.createElement('button');
    tabs.append(button);
    article.append(tabs);

    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    fireEvent.click(button);
    expect(onSelection).not.toHaveBeenCalled();
    tabs.remove();
    window.getSelection()?.removeAllRanges();
  });

  it('렌더링된 Markdown에서 텍스트 선택의 원문 범위를 전달한다', async () => {
    const onSelection = vi.fn();
    const article = renderMarkdown('Review this sentence', onSelection);
    await waitFor(() => expect(hasRenderedSourceMap(article)).toBe(true), { timeout: 5_000 });
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
    await loadSourceImages(article);
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
    await loadSourceImages(article);
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
    await loadSourceImages(article);
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

  it('기존 피드백이 있는 다이어그램을 클릭하면 해당 피드백을 선택한다', async () => {
    const onSelection = vi.fn();
    const markdown = '```mermaid\nflowchart LR\n```';
    const article = renderMarkdown(markdown, onSelection, [
      {
        id: 'diagram-feedback',
        scope: 'selection',
        quote: markdown,
        start: 0,
        end: markdown.length,
        feedback: '이 다이어그램을 검토해 주세요.',
      },
    ]);
    await waitFor(() => expect(hasRenderedSourceMap(article)).toBe(true));
    const codeBlock = article.querySelector<HTMLElement>('.milkdown-code-block');
    expect(codeBlock).not.toBeNull();
    codeBlock?.classList.add('mermaid-preview-open');

    fireEvent.click(codeBlock as HTMLElement);

    expect(onSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        annotationId: 'diagram-feedback',
        quote: markdown,
        start: 0,
        end: markdown.length,
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
    await loadSourceImages(article);
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
