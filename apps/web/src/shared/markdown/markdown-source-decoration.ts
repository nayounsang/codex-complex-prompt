import {
  getConfiguredAttachmentExtension,
  getConfiguredAttachmentId,
  getMarkdownAttachmentExtension,
  getMarkdownAttachmentId,
  MARKDOWN_ATTACHMENT_DIRECTORY,
} from './attachment-path.js';
import {
  getCodeBlockSourceRanges,
  getMarkdownAttachmentImageRanges,
  type MarkdownAttachmentImageRange,
} from './markdown-source-ast.js';
import { getMarkdownTableRanges } from './markdown-source-text-map.js';
import type { RenderedTextMapping, SourceFeedbackRange } from './markdown-source-map-types.js';

const feedbackHighlightName = 'feedback-annotation';

function decorateAttachmentImages(
  root: HTMLElement,
  markdown: string,
  feedbackRanges: readonly SourceFeedbackRange[],
  attachmentUrl: string | null,
): void {
  const imageRanges = getMarkdownAttachmentImageRanges(markdown);
  const rangesById = new Map<string, MarkdownAttachmentImageRange[]>();
  for (const range of imageRanges) {
    const ranges = rangesById.get(range.id) ?? [];
    ranges.push(range);
    rangesById.set(range.id, ranges);
  }
  for (const image of root.querySelectorAll<HTMLImageElement>('img')) {
    const id = getAttachmentImageId(image, attachmentUrl);
    const extension = getAttachmentImageExtension(image, attachmentUrl);
    const matchingRanges = id === null ? undefined : rangesById.get(id);
    const sourceRange = matchingRanges?.shift();
    if (sourceRange === undefined) {
      delete image.dataset['feedbackSourceStart'];
      delete image.dataset['feedbackSourceEnd'];
      image.removeAttribute('role');
      image.removeAttribute('tabindex');
      image.removeAttribute('aria-label');
      image.classList.remove('feedback-image-highlight');
      continue;
    }
    image.dataset['feedbackSourceStart'] = String(sourceRange.start);
    image.dataset['feedbackSourceEnd'] = String(sourceRange.end);
    image.setAttribute('role', 'button');
    image.tabIndex = 0;
    image.setAttribute(
      'aria-label',
      `Select image for feedback: ${image.alt.trim() || 'Drawing'} (${MARKDOWN_ATTACHMENT_DIRECTORY}/${id}.${extension ?? 'png'})`,
    );
    image.classList.toggle(
      'feedback-image-highlight',
      feedbackRanges.some(
        (range) => range.start < sourceRange.end && range.end > sourceRange.start,
      ),
    );
  }
}

function getAttachmentImageId(
  image: HTMLImageElement,
  attachmentUrl: string | null,
): string | null {
  const source = image.getAttribute('src');
  if (source === null) return null;
  return getMarkdownAttachmentId(source, true) ?? getConfiguredAttachmentId(source, attachmentUrl);
}

function getAttachmentImageExtension(
  image: HTMLImageElement,
  attachmentUrl: string | null,
): string | null {
  const source = image.getAttribute('src');
  if (source === null) return null;
  return (
    getMarkdownAttachmentExtension(source) ??
    getConfiguredAttachmentExtension(source, attachmentUrl)
  );
}

function decorateTableSourceRanges(
  root: HTMLElement,
  markdown: string,
  feedbackRanges: readonly SourceFeedbackRange[],
): void {
  const tableRanges = getMarkdownTableRanges(markdown);
  const tableBlocks = Array.from(root.querySelectorAll<HTMLElement>('.milkdown-table-block'));
  tableBlocks.forEach((tableBlock, index) => {
    const tableRange = tableRanges[index];
    if (tableRange === undefined) {
      delete tableBlock.dataset['tableSourceStart'];
      delete tableBlock.dataset['tableSourceEnd'];
      tableBlock.classList.remove('feedback-table-highlight');
      return;
    }
    tableBlock.dataset['tableSourceStart'] = String(tableRange.start);
    tableBlock.dataset['tableSourceEnd'] = String(tableRange.end);
    tableBlock.classList.toggle(
      'feedback-table-highlight',
      feedbackRanges.some(
        (feedbackRange) =>
          feedbackRange.start < tableRange.end && feedbackRange.end > tableRange.start,
      ),
    );
  });
}

function decorateCodeBlockSourceRanges(
  root: HTMLElement,
  markdown: string,
  feedbackRanges: readonly SourceFeedbackRange[],
): void {
  const codeRanges = getCodeBlockSourceRanges(markdown);
  const codeBlocks = Array.from(root.querySelectorAll<HTMLElement>('.milkdown-code-block'));
  codeBlocks.forEach((codeBlock, index) => {
    const sourceRange = codeRanges[index];
    codeBlock.classList.remove('feedback-code-highlight');
    delete codeBlock.dataset['feedbackIds'];
    if (sourceRange === undefined) {
      delete codeBlock.dataset['codeSourceStart'];
      delete codeBlock.dataset['codeSourceEnd'];
      return;
    }
    codeBlock.dataset['codeSourceStart'] = String(sourceRange.start);
    codeBlock.dataset['codeSourceEnd'] = String(sourceRange.end);
    const matchingRanges = feedbackRanges.filter(
      (feedbackRange) =>
        feedbackRange.start < sourceRange.end && feedbackRange.end > sourceRange.start,
    );
    if (matchingRanges.length === 0) return;
    codeBlock.classList.add('feedback-code-highlight');
    codeBlock.dataset['feedbackIds'] = matchingRanges.map((range) => range.id).join(',');
  });
}

export function paintFeedbackHighlights(
  mappings: readonly RenderedTextMapping[],
  feedbackRanges: readonly SourceFeedbackRange[],
): void {
  type HighlightInstance = { add: (range: Range) => void; readonly size: number };
  type HighlightConstructor = new () => HighlightInstance;
  const cssHighlights = (
    CSS as typeof CSS & {
      highlights?: {
        set: (name: string, highlight: HighlightInstance) => void;
        delete: (name: string) => void;
      };
    }
  ).highlights;
  const HighlightClass = (globalThis as typeof globalThis & { Highlight?: HighlightConstructor })
    .Highlight;
  if (cssHighlights === undefined || HighlightClass === undefined) return;
  cssHighlights.delete(feedbackHighlightName);
  const highlight = new HighlightClass();
  for (const feedbackRange of feedbackRanges) {
    const start = findHighlightPoint(mappings, feedbackRange.start, 'start');
    const end = findHighlightPoint(mappings, feedbackRange.end, 'end');
    if (start === null || end === null) continue;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    highlight.add(range);
  }
  if (highlight.size > 0) cssHighlights.set(feedbackHighlightName, highlight);
}

function findHighlightPoint(
  mappings: readonly RenderedTextMapping[],
  target: number,
  edge: 'start' | 'end',
): { readonly node: Text; readonly offset: number } | null {
  for (const mapping of mappings) {
    for (const character of mapping.characters) {
      if (edge === 'start' && target >= character.end) continue;
      if (edge === 'end' && target > character.end) continue;
      if (target < character.start && edge === 'end') return null;
      return {
        node: mapping.node,
        offset: edge === 'start' ? character.localStart : character.localEnd,
      };
    }
  }
  return null;
}

export function decorateMarkdownRanges(
  root: HTMLElement,
  markdown: string,
  ranges: readonly SourceFeedbackRange[],
  sourceMarkdown: string,
  attachmentUrl: string | null,
): void {
  decorateTableSourceRanges(root, markdown, ranges);
  decorateCodeBlockSourceRanges(root, markdown, ranges);
  decorateAttachmentImages(root, sourceMarkdown, ranges, attachmentUrl);
}
