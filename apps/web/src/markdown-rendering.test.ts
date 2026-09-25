import { describe, expect, it } from 'vitest';

import { makeMarkdownImagesInert } from './markdown-rendering.js';

describe('읽기 전용 Markdown 렌더링', () => {
  it('외부 이미지를 일반 Markdown 텍스트로 바꾼다', () => {
    const markdown = 'Before ![Tracker](https://attacker.example/pixel) after';

    const rendered = makeMarkdownImagesInert(markdown);

    expect(rendered).toBe('Before \\[Tracker](https://attacker.example/pixel) after');
    expect(rendered).toHaveLength(markdown.length);
  });

  it('코드 블록 안의 이미지 문법은 변경하지 않는다', () => {
    const markdown = '```md\n![Example](https://example.com/image.png)\n```';

    const rendered = makeMarkdownImagesInert(markdown);

    expect(rendered).toBe(markdown);
  });
});
