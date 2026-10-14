import { describe, expect, it } from 'vitest';

import { serializeFeedback } from './feedback.js';

describe('contextual selected feedback serialization', () => {
  it('provides surrounding design context when feedback refers to decisions under a selected title', () => {
    const markdown = [
      '# Webhook Delivery Proposal',
      '## Delivery guarantees',
      '- HTTP 429 responses are transient failures and use the standard retry policy.',
      '- Failed deliveries remain available for operator replay for seven days.',
      '## Open decisions',
      '- Should destination HTTP 429 responses be retried or treated as permanent failures?',
      '- How long should failed deliveries remain available for replay?',
      '## Rollout checklist',
      '- Enable the new delivery worker for five percent of tenants.',
    ].join('\n');
    const quote = 'Open decisions';
    const start = markdown.indexOf(quote);

    const result = serializeFeedback(markdown, [
      {
        id: 'decision-feedback',
        scope: 'selection',
        quote,
        start,
        end: start + quote.length,
        feedback:
          'Use the delivery guarantees above to resolve the decisions under this title. State the retry policy and replay retention period directly, and leave the rollout checklist unchanged.',
      },
    ]);

    expect(result).toContain(
      '- Use each selected quote and location as an anchor. Infer the requested edit scope from the feedback and surrounding context.',
    );
    expect(result).toContain('- Exact Markdown range: [');
    expect(result).toContain(
      '- Feedback: Use the delivery guarantees above to resolve the decisions under this title.',
    );
    expect(result).toContain(
      'HTTP 429 responses are transient failures and use the standard retry policy.',
    );
    expect(result).toContain('- Enable the new delivery worker for five percent of tenants.');
    expect(result).toContain('### Current Markdown\n\n' + markdown);
  });
});
