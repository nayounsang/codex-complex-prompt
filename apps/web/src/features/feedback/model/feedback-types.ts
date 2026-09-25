export type FeedbackScope = 'global' | 'selection';

export interface FeedbackAnnotation {
  readonly id: string;
  readonly scope: FeedbackScope;
  readonly quote?: string;
  readonly start?: number;
  readonly end?: number;
  readonly feedback: string;
}

import type { SelectionAnchor as MarkdownSelectionAnchor } from '../../../shared/markdown/types.js';

export interface SelectionAnchor extends MarkdownSelectionAnchor {
  readonly annotationId?: string;
}
