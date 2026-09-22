import { afterEach, describe, expect, it } from 'vitest';

import {
  getCodeBlockSelectionAnchor,
  getSelectionAnchor,
  getTableSelectionAnchor,
} from './selection-anchor.js';

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

  it('코드 블록 내부 일부를 선택해도 코드 전체 source 범위를 반환한다', () => {
    const root = document.createElement('article');
    const codeBlock = document.createElement('div');
    codeBlock.className = 'milkdown-code-block';
    codeBlock.dataset['codeSourceStart'] = '6';
    codeBlock.dataset['codeSourceEnd'] = '24';
    const content = document.createElement('div');
    content.className = 'cm-content';
    content.textContent = 'const answer = 42;';
    codeBlock.append(content);
    root.append(codeBlock);
    document.body.append(root);

    const range = document.createRange();
    range.setStart(content.firstChild as Text, 6);
    range.setEnd(content.firstChild as Text, 12);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const anchor = getCodeBlockSelectionAnchor(root, '```ts\nconst answer = 42;\n```');

    expect(anchor?.start).toBe(6);
    expect(anchor?.end).toBe(24);
    expect(anchor?.quote).toBe('const answer = 42;');
  });
});
