import type { FeedbackAnnotation, SelectionAnchor } from '../model/feedback-types.js';

export function mergeSelectionWithExistingFeedback(
  anchor: SelectionAnchor,
  annotations: readonly FeedbackAnnotation[],
  markdown: string,
): SelectionAnchor {
  const existing = annotations.find(
    (annotation) =>
      annotation.scope === 'selection' &&
      annotation.start !== undefined &&
      annotation.end !== undefined &&
      annotation.start < anchor.end &&
      annotation.end > anchor.start,
  );
  if (existing === undefined) return anchor;

  const start = Math.min(anchor.start, existing.start as number);
  const end = Math.max(anchor.end, existing.end as number);
  return {
    ...anchor,
    annotationId: existing.id,
    quote: markdown.slice(start, end),
    start,
    end,
  };
}
