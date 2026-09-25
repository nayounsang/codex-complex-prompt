import type { FeedbackAnnotation } from './feedback-types.js';

export function serializeFeedback(
  markdown: string,
  annotations: readonly FeedbackAnnotation[],
): string {
  const globalFeedback = annotations.filter((annotation) => annotation.scope === 'global');
  const selectionFeedback = annotations.filter((annotation) => annotation.scope === 'selection');
  const sections = ['## AI Feedback'];

  if (globalFeedback.length > 0) {
    sections.push(
      '',
      '### Global feedback',
      '',
      ...globalFeedback.map((annotation) => annotation.feedback),
    );
  }
  if (selectionFeedback.length > 0) {
    sections.push('', '### Selected feedback');
    for (const annotation of selectionFeedback) {
      const quote = annotation.quote ?? markdown.slice(annotation.start ?? 0, annotation.end ?? 0);
      const startLine = lineNumberAt(markdown, annotation.start ?? 0);
      const endLine = lineNumberAt(markdown, annotation.end ?? annotation.start ?? 0);
      sections.push(
        '',
        `> ${quote.replaceAll('\n', '\n> ')}`,
        '',
        `- 위치: line ${startLine}–${endLine}`,
        `- 피드백: ${annotation.feedback}`,
      );
    }
  }

  sections.push('', '### Current Markdown', '', markdown);

  return `${sections.join('\n')}\n`;
}

function lineNumberAt(markdown: string, offset: number): number {
  return markdown.slice(0, Math.max(0, offset)).split('\n').length;
}
