import type {
  FeedbackAnnotation,
  SelectionAnchor,
  SelectionFeedbackAnnotation,
} from '../model/feedback-types.js';

export function mergeSelectionWithExistingFeedback(
  anchor: SelectionAnchor,
  annotations: readonly FeedbackAnnotation[],
  markdown: string,
): SelectionAnchor {
  const existing = annotations.find(
    (annotation): annotation is SelectionFeedbackAnnotation =>
      annotation.scope === 'selection' &&
      annotation.start < anchor.end &&
      annotation.end > anchor.start,
  );
  if (existing === undefined) return anchor;

  const start = Math.min(anchor.start, existing.start);
  const end = Math.max(anchor.end, existing.end);
  return {
    ...anchor,
    annotationId: existing.id,
    quote: markdown.slice(start, end),
    start,
    end,
  };
}
