export type FeedbackScope = 'global' | 'selection';

export interface FeedbackAnnotation {
  readonly id: string;
  readonly scope: FeedbackScope;
  readonly quote?: string;
  readonly start?: number;
  readonly end?: number;
  readonly feedback: string;
}

export interface SelectionAnchor {
  readonly quote: string;
  readonly start: number;
  readonly end: number;
  readonly rect: SelectionRect;
  readonly annotationId?: string;
}

export interface SelectionRect {
  readonly x: number;
  readonly y: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}
