import { describe, expect, it } from 'vitest';

import { serializeFeedback } from './feedback-serializer.js';

describe('feedback 직렬화', () => {
  it('global과 선택 feedback을 Codex용 Markdown으로 직렬화한다', () => {
    const markdown = '# Title\n\nFix this paragraph.\nDone.';
    const annotations = [
      { id: 'global-1', scope: 'global' as const, feedback: '문서의 톤을 더 간결하게 바꿔주세요.' },
      {
        id: 'selection-1',
        scope: 'selection' as const,
        quote: 'Fix this paragraph.',
        start: 9,
        end: 28,
        feedback: '이 문장을 다시 작성해주세요.',
      },
    ];

    const result = serializeFeedback(markdown, annotations);

    expect(result).toBe(
      '## AI Feedback\n\n' +
        '### Global feedback\n\n' +
        '문서의 톤을 더 간결하게 바꿔주세요.\n\n' +
        '### Selected feedback\n\n' +
        '> Fix this paragraph.\n\n' +
        '- 위치: line 3–3\n' +
        '- 피드백: 이 문장을 다시 작성해주세요.\n',
    );
  });

  it('feedback이 없으면 제목만 포함한 Markdown을 반환한다', () => {
    const result = serializeFeedback('Original', []);

    expect(result).toBe('## AI Feedback\n');
  });
});
