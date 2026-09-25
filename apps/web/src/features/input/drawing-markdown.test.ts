import { describe, expect, it } from 'vitest';

import {
  findMarkdownDrawingReferences,
  removeMarkdownDrawingReferences,
} from './drawing-markdown.js';

describe('Markdown 그림 참조', () => {
  it('본문의 인라인 그림을 찾고 코드와 인용문 속 그림은 건너뛴다', () => {
    const id = '00000000-0000-4000-8000-000000000021';
    const markdown = [
      `설명 ![다이어그램](.complex-prompt/attachments/${id}.png) 계속`,
      `> ![인용 그림](.complex-prompt/attachments/00000000-0000-4000-8000-000000000022.png)`,
      '```md',
      '![예시 그림](.complex-prompt/attachments/00000000-0000-4000-8000-000000000023.png)',
      '```',
    ].join('\n');

    const drawings = findMarkdownDrawingReferences(markdown);

    expect(drawings).toEqual([{ id, label: '다이어그램' }]);
  });

  it('그림을 삭제하면 본문 참조만 지우고 주변 문장과 코드·인용문은 보존한다', () => {
    const id = '00000000-0000-4000-8000-000000000024';
    const quotedId = '00000000-0000-4000-8000-000000000025';
    const codeId = '00000000-0000-4000-8000-000000000026';
    const markdown = [
      `앞 문장 ![그림](.complex-prompt/attachments/${id}.png) 뒤 문장`,
      `> ![인용 그림](.complex-prompt/attachments/${quotedId}.png)`,
      '```md',
      `![예시 그림](.complex-prompt/attachments/${id}.png)`,
      `![다른 그림](.complex-prompt/attachments/${codeId}.png)`,
      '```',
    ].join('\n');

    const updatedMarkdown = removeMarkdownDrawingReferences(markdown, id);

    expect(updatedMarkdown).toBe(
      [
        '앞 문장  뒤 문장',
        `> ![인용 그림](.complex-prompt/attachments/${quotedId}.png)`,
        '```md',
        `![예시 그림](.complex-prompt/attachments/${id}.png)`,
        `![다른 그림](.complex-prompt/attachments/${codeId}.png)`,
        '```',
      ].join('\n'),
    );
  });
});
