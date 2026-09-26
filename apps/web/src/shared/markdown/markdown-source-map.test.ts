import { afterEach, describe, expect, it } from 'vitest';

import {
  decorateMarkdownRoot,
  getMappedSourceOffset,
  getVisibleSourceMap,
  hasRenderedSourceMap,
  locateMappedText,
} from './markdown-source-map.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('Markdown source map', () => {
  it('제목 마커 뒤 여러 공백을 건너뛴 source offset을 반환한다', () => {
    const markdown = '#   title';

    const characters = getVisibleSourceMap(markdown);

    expect(characters).toEqual([
      { char: 't', start: 4, end: 5 },
      { char: 'i', start: 5, end: 6 },
      { char: 't', start: 6, end: 7 },
      { char: 'l', start: 7, end: 8 },
      { char: 'e', start: 8, end: 9 },
    ]);
  });

  it('목록 마커 뒤 여러 공백을 건너뛴 source offset을 반환한다', () => {
    const markdown = '-   item';

    const characters = getVisibleSourceMap(markdown);

    expect(characters).toEqual([
      { char: 'i', start: 4, end: 5 },
      { char: 't', start: 5, end: 6 },
      { char: 'e', start: 6, end: 7 },
      { char: 'm', start: 7, end: 8 },
    ]);
  });

  it('인접한 astral 문자의 UTF-16 source offset을 보존한다', () => {
    const characters = getVisibleSourceMap('😀😀x');

    expect(characters).toEqual([
      { char: '😀', start: 0, end: 2 },
      { char: '😀', start: 2, end: 4 },
      { char: 'x', start: 4, end: 5 },
    ]);
  });

  it('ProseMirror 텍스트 노드를 교체하지 않고 source offset을 연결한다', () => {
    const root = document.createElement('div');
    root.className = 'ProseMirror';
    const paragraph = document.createElement('p');
    const text = document.createTextNode('First middle words');
    paragraph.append(text);
    root.append(paragraph);
    document.body.append(root);

    decorateMarkdownRoot(root, 'First middle words', []);

    expect(paragraph.firstChild).toBe(text);
    expect(paragraph.querySelector('span')).toBeNull();
    expect(hasRenderedSourceMap(root)).toBe(true);
    expect(getMappedSourceOffset(root, text, 6)).toBe(6);
    expect(locateMappedText(root, 12)).toEqual({ node: text, offset: 12 });
  });

  it('같은 UUID의 외부 이미지가 첨부 그림의 선택 범위를 차지하지 않는다', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const attachmentUrl = 'http://127.0.0.1:8765/_complex-prompt/attachments';
    const drawingMarkdown = `![drawing](.complex-prompt/attachments/${id}.png)`;
    const markdown = `![other](https://example.test/${id}.png)\n\n${drawingMarkdown}`;
    const root = document.createElement('div');
    root.className = 'ProseMirror';
    const externalImage = document.createElement('img');
    externalImage.src = `https://example.test/${id}.png`;
    const drawingImage = document.createElement('img');
    drawingImage.src = `${attachmentUrl}/${id}.png?token=test-token`;
    root.append(externalImage, drawingImage);
    document.body.append(root);

    decorateMarkdownRoot(root, markdown, [], markdown, attachmentUrl);

    expect(externalImage).not.toHaveAttribute('role', 'button');
    expect(externalImage.dataset['feedbackSourceStart']).toBeUndefined();
    expect(drawingImage).toHaveAttribute('role', 'button');
    expect(drawingImage.dataset['feedbackSourceStart']).toBe(
      String(markdown.indexOf(drawingMarkdown)),
    );
    expect(drawingImage.dataset['feedbackSourceEnd']).toBe(
      String(markdown.indexOf(drawingMarkdown) + drawingMarkdown.length),
    );
  });

  it('첨부 서버의 다른 경로에 있는 같은 UUID 이미지에는 선택 범위를 연결하지 않는다', () => {
    const id = '00000000-0000-4000-8000-000000000002';
    const attachmentUrl = 'http://127.0.0.1:8765/_complex-prompt/attachments';
    const drawingMarkdown = `![drawing](.complex-prompt/attachments/${id}.png)`;
    const root = document.createElement('div');
    root.className = 'ProseMirror';
    const wrongPathImage = document.createElement('img');
    wrongPathImage.src = `http://127.0.0.1:8765/preview/${id}.png`;
    root.append(wrongPathImage);
    document.body.append(root);

    decorateMarkdownRoot(root, drawingMarkdown, [], drawingMarkdown, attachmentUrl);

    expect(wrongPathImage).not.toHaveAttribute('role', 'button');
    expect(wrongPathImage.dataset['feedbackSourceStart']).toBeUndefined();
    expect(wrongPathImage.dataset['feedbackSourceEnd']).toBeUndefined();
  });
});
