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
});
