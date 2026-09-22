import { afterEach, describe, expect, it } from 'vitest';

import { getSelectionAnchor } from './selection-anchor.js';

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
});
