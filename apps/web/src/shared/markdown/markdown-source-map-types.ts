import type { SourceCharacter } from './markdown-source-text-map.js';

export interface SourceFeedbackRange {
  readonly start: number;
  readonly end: number;
  readonly id: string;
}

export interface RenderedCharacter extends SourceCharacter {
  readonly localStart: number;
  readonly localEnd: number;
}

export interface RenderedTextMapping {
  readonly node: Text;
  readonly characters: readonly RenderedCharacter[];
}
