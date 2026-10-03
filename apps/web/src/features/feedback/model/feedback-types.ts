export type {
  FeedbackAnnotation,
  FeedbackScope,
  GlobalFeedbackAnnotation,
  SelectionFeedbackAnnotation,
} from '@codex-complex-prompt/core/feedback';

import type { SelectionAnchor as MarkdownSelectionAnchor } from '../../../shared/markdown/types.js';

export interface SelectionAnchor extends MarkdownSelectionAnchor {
  readonly annotationId?: string;
}
