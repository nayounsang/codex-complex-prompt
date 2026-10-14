export interface GlobalFeedbackAnnotation {
  readonly id: string;
  readonly scope: 'global';
  readonly feedback: string;
}

export interface SelectionFeedbackAnnotation {
  readonly id: string;
  readonly scope: 'selection';
  /** The exact source text covered by this feedback. */
  readonly quote: string;
  /** Zero-based inclusive source offset. */
  readonly start: number;
  /** Zero-based exclusive source offset. */
  readonly end: number;
  readonly feedback: string;
}

export type FeedbackAnnotation = GlobalFeedbackAnnotation | SelectionFeedbackAnnotation;
export type FeedbackScope = FeedbackAnnotation['scope'];

export const FEEDBACK_EDIT_INSTRUCTION =
  'Apply the feedback to the complete Current Markdown document included below. Use each selected quote and location as an anchor, then infer the intended edit scope from the feedback and surrounding context. Edit related content when needed to fulfill the request, and preserve unrelated content and similar passages elsewhere. Global feedback may apply across the document. Preserve all other unaffected content. Return the complete updated Markdown only, without an introduction, summary, or code fence.\n\n';

export function serializeFeedback(
  markdown: string,
  annotations: readonly FeedbackAnnotation[],
): string {
  const globalFeedback = annotations.filter((annotation) => annotation.scope === 'global');
  const selectionFeedback = annotations.filter((annotation) => annotation.scope === 'selection');
  const sections = ['## AI Feedback'];

  if (selectionFeedback.length > 0) {
    sections.push('', '### Scope rules', '');
    if (globalFeedback.length > 0) {
      sections.push('- Global feedback applies across the document.');
    }
    sections.push(
      '- Use each selected quote and location as an anchor. Infer the requested edit scope from the feedback and surrounding context.',
      '- Edit related content when needed to fulfill the request. Do not change unrelated content or merely similar passages elsewhere.',
    );
  }

  if (globalFeedback.length > 0) {
    sections.push('', '### Global feedback', '', ...globalFeedback.map(({ feedback }) => feedback));
  }
  if (selectionFeedback.length > 0) {
    sections.push('', '### Selected feedback');
    for (const annotation of selectionFeedback) {
      const startLine = lineNumberAt(markdown, annotation.start);
      const endLine = lineNumberAt(markdown, annotation.end);
      sections.push(
        '',
        `> ${annotation.quote.replaceAll('\n', '\n> ')}`,
        '',
        `- Location: line ${startLine}–${endLine}`,
        `- Exact Markdown range: [${annotation.start}, ${annotation.end})`,
        `- Feedback: ${annotation.feedback}`,
      );
    }
  }

  sections.push('', '### Current Markdown', '', markdown);

  return `${sections.join('\n')}\n`;
}

function lineNumberAt(markdown: string, offset: number): number {
  return markdown.slice(0, Math.max(0, offset)).split('\n').length;
}
