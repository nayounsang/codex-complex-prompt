export interface SelectionAnchor {
  readonly quote: string;
  readonly start: number;
  readonly end: number;
  readonly rect: SelectionRect;
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
