import { describe, expect, it } from 'vitest';

import { serializeFeedback } from './feedback.js';

describe('feedback serialization', () => {
  it('serializes global and selected feedback with the current document', () => {
    const markdown = '# Title\n\nFix this paragraph.\nDone.';
    const annotations = [
      { id: 'global-1', scope: 'global' as const, feedback: 'Make the document more concise.' },
      {
        id: 'selection-1',
        scope: 'selection' as const,
        quote: 'Fix this paragraph.',
        start: 9,
        end: 28,
        feedback: 'Rewrite this sentence.',
      },
    ];

    const result = serializeFeedback(markdown, annotations);

    expect(result).toBe(
      '## AI Feedback\n\n' +
        '### Scope rules\n\n' +
        '- Global feedback applies across the document.\n' +
        '- Selected feedback applies only to the exact quoted text at its listed location.\n' +
        '- Treat each selection as a hard edit boundary. Do not apply its feedback to matching, similar, or related text elsewhere.\n' +
        '- Keep all Markdown outside each selected range unchanged. Never broaden a selection request into a document-wide change.\n\n' +
        '### Global feedback\n\n' +
        'Make the document more concise.\n\n' +
        '### Selected feedback\n\n' +
        '> Fix this paragraph.\n\n' +
        '- Location: line 3–3\n' +
        '- Exact Markdown range: [9, 28)\n' +
        '- Feedback: Rewrite this sentence.\n\n' +
        '### Current Markdown\n\n' +
        markdown +
        '\n',
    );
  });

  it('includes the document when there is no feedback', () => {
    expect(serializeFeedback('Original', [])).toBe(
      '## AI Feedback\n\n### Current Markdown\n\nOriginal\n',
    );
  });

  it('keeps selected-only feedback scoped to its exact range', () => {
    const result = serializeFeedback('First paragraph.\n\nSecond paragraph.', [
      {
        id: 'selection-1',
        scope: 'selection',
        quote: 'First paragraph.',
        start: 0,
        end: 16,
        feedback: 'Change this sentence.',
      },
    ]);

    expect(result).toContain(
      '- Selected feedback applies only to the exact quoted text at its listed location.',
    );
    expect(result).toContain('- Exact Markdown range: [0, 16)');
    expect(result).not.toContain('Global feedback applies across the document.');
    expect(result).toContain('### Current Markdown\n\nFirst paragraph.\n\nSecond paragraph.');
  });
});
