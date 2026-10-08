import type { SourceCharacter } from './markdown-source-text-map.js';
import {
  findSourceCharacter,
  findSourceIndexAtOrAfter,
  getMarkdownTableRanges,
  getVisibleSourceMap,
} from './markdown-source-text-map.js';
import {
  getCodeBlockSourceLineOffsets,
  getCodeBlockSourceRanges,
  getMarkdownAttachmentImageRanges,
  type MarkdownAttachmentImageRange,
} from './markdown-source-ast.js';
export type { SourceCharacter } from './markdown-source-text-map.js';
export type { MarkdownImageSourceRange } from './markdown-source-ast.js';
export {
  countMarkdownImageOccurrences,
  getCodeBlockSourceRanges,
  getCodeBlockSourceLineOffsets,
  getEmptyImageSourceRanges,
} from './markdown-source-ast.js';
export { getVisibleSourceMap, getMarkdownTableRanges } from './markdown-source-text-map.js';

import {
  getConfiguredAttachmentExtension,
  getConfiguredAttachmentId,
  getMarkdownAttachmentExtension,
  getMarkdownAttachmentId,
  MARKDOWN_ATTACHMENT_DIRECTORY,
} from './attachment-path.js';

export interface SourceFeedbackRange {
  readonly start: number;
  readonly end: number;
  readonly id: string;
}

interface RenderedCharacter extends SourceCharacter {
  readonly localStart: number;
  readonly localEnd: number;
}

interface RenderedTextMapping {
  readonly node: Text;
  readonly characters: readonly RenderedCharacter[];
}

const renderedTextMappings = new WeakMap<HTMLElement, readonly RenderedTextMapping[]>();
const feedbackHighlightName = 'feedback-annotation';

export function decorateMarkdownRoot(
  root: HTMLElement,
  markdown: string,
  ranges: readonly SourceFeedbackRange[],
  sourceMarkdown: string = markdown,
  attachmentUrl: string | null = null,
): void {
  const proseMirror = root.matches('.ProseMirror')
    ? root
    : root.querySelector<HTMLElement>('.ProseMirror');
  if (proseMirror === null) return;
  const sortedRanges = [...ranges].sort((left, right) => left.start - right.start);
  decorateTableSourceRanges(proseMirror, markdown, sortedRanges);
  decorateCodeBlockSourceRanges(proseMirror, markdown, sortedRanges);
  decorateAttachmentImages(proseMirror, sourceMarkdown, sortedRanges, attachmentUrl);

  const sourceMap = getVisibleSourceMap(markdown);
  const mappings: RenderedTextMapping[] = [];
  const mappedCodeBlocks = new Set<HTMLElement>();
  const walker = document.createTreeWalker(proseMirror, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentNode instanceof Element ? node.parentNode : null;
      if (parent !== null && parent.closest('.milkdown-code-block') !== null) {
        return NodeFilter.FILTER_ACCEPT;
      }
      if (parent === null || isDecoratedUiText(parent)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let current = walker.nextNode();
  let sourceIndex = 0;
  while (current !== null) {
    const textNode = current as Text;
    current = walker.nextNode();
    const text = textNode.textContent ?? '';
    if (text === '') continue;
    const codeBlock = textNode.parentElement?.closest<HTMLElement>('.milkdown-code-block');
    if (codeBlock !== null && codeBlock !== undefined) {
      const codeEnd = Number(codeBlock.dataset['codeSourceEnd']);
      if (!mappedCodeBlocks.has(codeBlock)) {
        mappedCodeBlocks.add(codeBlock);
        const codeStart = Number(codeBlock.dataset['codeSourceStart']);
        if (Number.isFinite(codeStart) && Number.isFinite(codeEnd)) {
          mappings.push(...mapCodeBlockText(codeBlock, codeStart, codeEnd, markdown));
          sourceIndex = Math.max(sourceIndex, findSourceIndexAtOrAfter(sourceMap, codeEnd));
        }
      }
      continue;
    }
    const characters: RenderedCharacter[] = [];
    let localOffset = 0;
    for (const char of text) {
      const mapped = findSourceCharacter(char, sourceMap, sourceIndex);
      if (mapped === null) {
        localOffset += char.length;
        continue;
      }
      sourceIndex = mapped.index + 1;
      characters.push({
        ...mapped.character,
        localStart: localOffset,
        localEnd: localOffset + char.length,
      });
      localOffset += char.length;
    }
    if (characters.length > 0) mappings.push({ node: textNode, characters });
  }
  renderedTextMappings.set(proseMirror, mappings);
  paintFeedbackHighlights(mappings, sortedRanges);
}

function mapCodeBlockText(
  codeBlock: HTMLElement,
  sourceStart: number,
  sourceEnd: number,
  markdown: string,
): RenderedTextMapping[] {
  const codeContent = codeBlock.querySelector<HTMLElement>('.cm-content');
  if (codeContent === null) return [];
  const lines = Array.from(codeContent.querySelectorAll<HTMLElement>('.cm-line'));
  const mappings: RenderedTextMapping[] = [];
  const lineStarts = getCodeBlockSourceLineOffsets(
    markdown,
    sourceStart,
    lines.map((line) => line.textContent ?? ''),
  );
  lines.forEach((line, lineIndex) => {
    const lineStart = lineStarts[lineIndex] ?? sourceStart;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    let lineOffset = 0;
    while (current !== null) {
      const node = current as Text;
      const text = node.textContent ?? '';
      const characters: RenderedCharacter[] = [];
      let localOffset = 0;
      for (const char of text) {
        const start = lineStart + lineOffset + localOffset;
        const end = start + char.length;
        if (end <= sourceEnd) {
          characters.push({
            char,
            start,
            end,
            localStart: localOffset,
            localEnd: localOffset + char.length,
          });
        }
        localOffset += char.length;
      }
      if (characters.length > 0) mappings.push({ node, characters });
      lineOffset += text.length;
      current = walker.nextNode();
    }
  });
  return mappings;
}

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

function isDecoratedUiText(element: Element): boolean {
  return (
    element.closest(
      [
        '.ProseMirror-widget',
        '.label-wrapper',
        '.milkdown-icon',
        '.tools',
        '.language-picker',
        '.cm-announced',
        '.cm-gutters',
        '.cm-layer',
        '.cm-content',
        '.milkdown-code-block',
        '[data-role]',
        '[data-show]',
        '[draggable="true"]',
        '.handle',
        '[aria-hidden="true"]',
      ].join(','),
    ) !== null
  );
}

export function getMappedSourceOffset(
  root: HTMLElement,
  container: Node,
  offset: number,
): number | null {
  const proseMirror = root.matches('.ProseMirror')
    ? root
    : root.querySelector<HTMLElement>('.ProseMirror');
  if (proseMirror === null) return null;
  const mappings = renderedTextMappings.get(proseMirror);
  if (mappings === undefined) return null;
  const textMapping = mappings.find((mapping) => mapping.node === container);
  if (textMapping !== undefined) return sourceOffsetInText(textMapping, offset);
  if (container.nodeType !== Node.ELEMENT_NODE) return null;

  let previous: RenderedTextMapping | undefined;
  for (const mapping of mappings) {
    const textRange = document.createRange();
    textRange.selectNodeContents(mapping.node);
    const position = textRange.comparePoint(container, offset);
    if (position === -1) return mapping.characters[0]?.start ?? null;
    if (position === 0) return sourceOffsetInText(mapping, 0);
    previous = mapping;
  }
  return previous?.characters.at(-1)?.end ?? null;
}

export function hasRenderedSourceMap(root: HTMLElement): boolean {
  const proseMirror = root.matches('.ProseMirror')
    ? root
    : root.querySelector<HTMLElement>('.ProseMirror');
  return proseMirror !== null && renderedTextMappings.has(proseMirror);
}

export function locateMappedText(
  root: HTMLElement,
  target: number,
): { readonly node: Text; readonly offset: number } | null {
  const proseMirror = root.matches('.ProseMirror')
    ? root
    : root.querySelector<HTMLElement>('.ProseMirror');
  if (proseMirror === null) return null;
  const mappings = renderedTextMappings.get(proseMirror);
  if (mappings === undefined) return null;
  for (const mapping of mappings) {
    const first = mapping.characters[0];
    const last = mapping.characters.at(-1);
    if (first === undefined || last === undefined || target < first.start || target > last.end)
      continue;
    for (const character of mapping.characters) {
      if (target <= character.end) {
        return {
          node: mapping.node,
          offset: target <= character.start ? character.localStart : character.localEnd,
        };
      }
    }
  }
  return null;
}

function sourceOffsetInText(mapping: RenderedTextMapping, offset: number): number | null {
  const first = mapping.characters[0];
  const last = mapping.characters.at(-1);
  if (first === undefined || last === undefined) return null;
  if (offset <= first.localStart) return first.start;
  for (let index = 0; index < mapping.characters.length; index += 1) {
    const character = mapping.characters[index];
    if (character === undefined || offset > character.localEnd) continue;
    if (offset <= character.localStart) return character.start;
    const next = mapping.characters[index + 1];
    return offset === character.localEnd && next !== undefined ? next.start : character.end;
  }
  return last.end;
}

function paintFeedbackHighlights(
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
