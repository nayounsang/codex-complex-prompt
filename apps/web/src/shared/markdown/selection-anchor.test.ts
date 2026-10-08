import { afterEach, describe, expect, it } from 'vitest';

import {
  getCodeBlockSelectionAnchor,
  getImageSelectionAnchor,
  getSelectionAnchor,
  getTableSelectionAnchor,
} from './selection-anchor.js';
import { getCodeBlockSourceRanges } from './markdown-source-map.js';

afterEach(() => {
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

describe('선택 영역 anchor', () => {
  it('중첩된 source span의 끝에서 마지막 자식의 offset을 반환한다', () => {
    const root = document.createElement('article');
    const container = document.createElement('p');
    const wrapper = document.createElement('span');
    const first = document.createElement('span');
    first.dataset['sourceStart'] = '0';
    first.dataset['sourceEnd'] = '3';
    first.textContent = 'foo';
    const second = document.createElement('span');
    second.dataset['sourceStart'] = '3';
    second.dataset['sourceEnd'] = '6';
    second.textContent = 'bar';
    wrapper.append(first, second);
    container.append(wrapper);
    root.append(container);
    document.body.append(root);

    const range = document.createRange();
    range.setStart(first.firstChild as Text, 0);
    range.setEnd(container, container.childNodes.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const anchor = getSelectionAnchor(root);

    expect(anchor?.start).toBe(0);
    expect(anchor?.end).toBe(6);
    expect(anchor?.quote).toBe('foobar');
  });

  it('ProseMirror가 여러 표 셀을 CellSelection으로 만들면 표 전체 source 범위를 반환한다', () => {
    const root = document.createElement('article');
    const tableBlock = document.createElement('div');
    tableBlock.className = 'milkdown-table-block';
    const table = document.createElement('table');
    const row = document.createElement('tr');
    const firstCell = document.createElement('td');
    firstCell.className = 'selectedCell';
    firstCell.textContent = 'Header';
    const secondCell = document.createElement('td');
    secondCell.className = 'selectedCell';
    secondCell.textContent = 'Cell';
    row.append(firstCell, secondCell);
    table.append(row);
    tableBlock.append(table);
    root.append(tableBlock);
    document.body.append(root);

    const anchor = getTableSelectionAnchor(root, 'prefix\n| Header |\n| --- |\n| Cell | end');

    expect(anchor?.start).toBe(7);
    expect(anchor?.end).toBe(38);
    expect(anchor?.quote).toBe('| Header |\n| --- |\n| Cell | end');
  });

  it('코드 블록 내부에서 선택한 텍스트만 source 범위로 반환한다', () => {
    const root = document.createElement('article');
    const codeBlock = document.createElement('div');
    codeBlock.className = 'milkdown-code-block';
    codeBlock.dataset['codeSourceStart'] = '6';
    codeBlock.dataset['codeSourceEnd'] = '24';
    const content = document.createElement('div');
    content.className = 'cm-content';
    const line = document.createElement('div');
    line.className = 'cm-line';
    line.textContent = 'const answer = 42;';
    content.append(line);
    codeBlock.append(content);
    root.append(codeBlock);
    document.body.append(root);

    const range = document.createRange();
    range.setStart(line.firstChild as Text, 6);
    range.setEnd(line.firstChild as Text, 12);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const anchor = getCodeBlockSelectionAnchor(root, '```ts\nconst answer = 42;\n```');

    expect(anchor?.start).toBe(12);
    expect(anchor?.end).toBe(18);
    expect(anchor?.quote).toBe('answer');
  });

  it('CRLF 코드 블록 둘째 줄의 선택 offset을 원문과 일치시킨다', () => {
    const markdown = '```ts\r\nconst first = 0;\r\nconst bar = 2;\r\n```';
    const root = document.createElement('article');
    const codeBlock = document.createElement('div');
    codeBlock.className = 'milkdown-code-block';
    codeBlock.dataset['codeSourceStart'] = String(markdown.indexOf('const first'));
    codeBlock.dataset['codeSourceEnd'] = String(markdown.indexOf('\r\n```'));
    const content = document.createElement('div');
    content.className = 'cm-content';
    const firstLine = document.createElement('div');
    firstLine.className = 'cm-line';
    firstLine.textContent = 'const first = 0;';
    const secondLine = document.createElement('div');
    secondLine.className = 'cm-line';
    secondLine.textContent = 'const bar = 2;';
    content.append(firstLine, secondLine);
    codeBlock.append(content);
    root.append(codeBlock);
    document.body.append(root);

    const range = document.createRange();
    range.setStart(secondLine.firstChild as Text, 6);
    range.setEnd(secondLine.firstChild as Text, 9);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const anchor = getCodeBlockSelectionAnchor(root, markdown);
    const expectedStart = markdown.indexOf('bar');

    expect(anchor).toMatchObject({
      start: expectedStart,
      end: expectedStart + 'bar'.length,
      quote: 'bar',
    });
  });

  it('블록 인용 코드 블록의 선택 offset에서 컨테이너 마커를 건너뛴다', () => {
    const markdown = '> ```ts\n> const answer = 42;\n> ```';
    const sourceRange = getCodeBlockSourceRanges(markdown)[0];
    const root = document.createElement('article');
    const codeBlock = document.createElement('div');
    codeBlock.className = 'milkdown-code-block';
    codeBlock.dataset['codeSourceStart'] = String(sourceRange?.start);
    codeBlock.dataset['codeSourceEnd'] = String(sourceRange?.end);
    const content = document.createElement('div');
    content.className = 'cm-content';
    const line = document.createElement('div');
    line.className = 'cm-line';
    line.textContent = 'const answer = 42;';
    content.append(line);
    codeBlock.append(content);
    root.append(codeBlock);
    document.body.append(root);

    const range = document.createRange();
    range.setStart(line.firstChild as Text, 6);
    range.setEnd(line.firstChild as Text, 12);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const anchor = getCodeBlockSelectionAnchor(root, markdown);
    const expectedStart = markdown.indexOf('answer');

    expect(anchor).toMatchObject({
      start: expectedStart,
      end: expectedStart + 'answer'.length,
      quote: 'answer',
    });
  });
  it('이미지 source 범위가 음수이거나 역전되면 anchor를 만들지 않는다', () => {
    const root = document.createElement('article');
    const image = document.createElement('img');
    image.dataset['feedbackSourceStart'] = '-1';
    image.dataset['feedbackSourceEnd'] = '4';
    root.append(image);

    expect(getImageSelectionAnchor(root, '![x](image.png)', image)).toBeNull();

    image.dataset['feedbackSourceStart'] = '8';
    image.dataset['feedbackSourceEnd'] = '4';
    expect(getImageSelectionAnchor(root, '![x](image.png)', image)).toBeNull();
  });
});
