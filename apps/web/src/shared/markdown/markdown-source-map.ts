import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import {
  getConfiguredAttachmentExtension,
  getConfiguredAttachmentId,
  getMarkdownAttachmentExtension,
  getMarkdownAttachmentId,
  MARKDOWN_ATTACHMENT_DIRECTORY,
} from './attachment-path.js';

export interface SourceCharacter {
  readonly char: string;
  readonly start: number;
  readonly end: number;
}

export interface SourceFeedbackRange {
  readonly start: number;
  readonly end: number;
  readonly id: string;
}

interface MarkdownAttachmentImageRange {
  readonly id: string;
  readonly start: number;
  readonly end: number;
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

const tableSeparatorPattern = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/;
const blockStartPattern = /^\s*(?:#{1,6}\s|[-+*]\s|\d+[.]\s|>\s?|```)/;

export function getVisibleSourceMap(markdown: string): SourceCharacter[] {
  const lines = markdown.split('\n');
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }

  const characters: SourceCharacter[] = [];
  const appendLine = (line: string, start: number): void => {
    appendInline(line, start, characters);
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    if (/^\s*```/.test(line)) {
      const closingFence = lines.findIndex(
        (candidate, candidateIndex) => candidateIndex > index && /^\s*```/.test(candidate),
      );
      const end = closingFence === -1 ? lines.length : closingFence;
      for (let codeLine = index + 1; codeLine < end; codeLine += 1) {
        const code = lines[codeLine] ?? '';
        appendLiteral(code, lineStarts[codeLine] ?? markdown.length, characters);
        if (codeLine + 1 < end) {
          const codeStart = lineStarts[codeLine] ?? markdown.length;
          appendCharacter('\n', codeStart + code.length, codeStart + code.length + 1, characters);
        }
      }
      index = closingFence === -1 ? lines.length : closingFence + 1;
      continue;
    }

    if (isTableHeader(line, lines[index + 1] ?? '')) {
      const tableEnd = findTableEnd(lines, index);
      for (let tableLine = index; tableLine < tableEnd; tableLine += 1) {
        if (tableLine === index + 1) continue;
        appendTableRow(
          lines[tableLine] ?? '',
          lineStarts[tableLine] ?? markdown.length,
          characters,
        );
      }
      index = tableEnd;
      continue;
    }

    const heading = line.match(/^(\s*)(#{1,6})(\s+)(.+?)\s*$/);
    if (heading !== null) {
      const content = stripClosingHeadingMarker(heading[4] ?? '');
      const lineStart = lineStarts[index] ?? markdown.length;
      const contentStart =
        lineStart +
        (heading[1]?.length ?? 0) +
        (heading[2]?.length ?? 0) +
        (heading[3]?.length ?? 0);
      appendLine(content.text, contentStart + content.leadingTrim);
      index += 1;
      continue;
    }

    const list = line.match(/^(\s*)([-+*]|\d+[.])(\s+)(?:\[[ xX]\]\s+)?(.*)$/);
    if (list !== null) {
      const content = list[4] ?? '';
      const lineStart = lineStarts[index] ?? markdown.length;
      const contentStart =
        lineStart + (list[1]?.length ?? 0) + (list[2]?.length ?? 0) + (list[3]?.length ?? 0);
      const taskPrefix = /^\[[ xX]\]\s+/.exec(line.slice(contentStart - lineStart));
      appendLine(content, contentStart + (taskPrefix?.[0].length ?? 0));
      index += 1;
      continue;
    }

    const quote = line.match(/^(\s*)>\s?(.*)$/);
    if (quote !== null) {
      const content = quote[2] ?? '';
      const lineStart = lineStarts[index] ?? markdown.length;
      appendLine(
        content,
        lineStart +
          (quote[1]?.length ?? 0) +
          1 +
          (content === '' ? 0 : line.slice((quote[1]?.length ?? 0) + 1).indexOf(content)),
      );
      index += 1;
      continue;
    }

    const paragraphStart = index;
    while (
      index + 1 < lines.length &&
      (lines[index + 1] ?? '').trim() !== '' &&
      !blockStartPattern.test(lines[index + 1] ?? '') &&
      !isTableHeader(lines[index + 1] ?? '', lines[index + 2] ?? '')
    ) {
      index += 1;
    }
    for (let paragraphLine = paragraphStart; paragraphLine <= index; paragraphLine += 1) {
      const paragraph = lines[paragraphLine] ?? '';
      appendLine(paragraph, lineStarts[paragraphLine] ?? markdown.length);
      if (paragraphLine < index) {
        const paragraphStartOffset = lineStarts[paragraphLine] ?? markdown.length;
        appendCharacter(
          '\n',
          paragraphStartOffset + paragraph.length,
          paragraphStartOffset + paragraph.length + 1,
          characters,
        );
      }
    }
    index += 1;
  }
  return characters;
}

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

function getMarkdownAttachmentImageRanges(markdown: string): MarkdownAttachmentImageRange[] {
  const ranges: MarkdownAttachmentImageRange[] = [];
  const tree = parseMarkdownTree(markdown);
  const visit = (node: MarkdownNode): void => {
    if (node.type === 'image' && node.url !== undefined && node.position !== undefined) {
      const id = getMarkdownAttachmentId(node.url);
      const { start, end } = node.position;
      if (id !== null && typeof start.offset === 'number' && typeof end.offset === 'number') {
        ranges.push({ id, start: start.offset, end: end.offset });
      }
    }
    node.children?.forEach(visit);
  };
  visit(tree);

  return ranges;
}

interface MarkdownNode {
  readonly type: string;
  readonly url?: string;
  readonly position?: {
    readonly start: { readonly offset?: number; readonly line?: number };
    readonly end: { readonly offset?: number; readonly line?: number };
  };
  readonly children?: readonly MarkdownNode[];
}

export function countMarkdownImageOccurrences(
  markdown: string,
  targets: readonly string[],
): Map<string, number> {
  const targetSet = new Set(targets);
  const occurrences = new Map<string, number>();
  if (targetSet.size === 0) return occurrences;

  const tree = parseMarkdownTree(markdown);
  const visit = (node: MarkdownNode): void => {
    if (
      node.type === 'image' &&
      node.position !== undefined &&
      typeof node.position.start.offset === 'number' &&
      typeof node.position.end.offset === 'number'
    ) {
      const imageMarkdown = markdown.slice(node.position.start.offset, node.position.end.offset);
      if (targetSet.has(imageMarkdown))
        occurrences.set(imageMarkdown, (occurrences.get(imageMarkdown) ?? 0) + 1);
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  return occurrences;
}

function parseMarkdownTree(markdown: string): MarkdownNode {
  return unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownNode;
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

export function getCodeBlockSourceRanges(
  markdown: string,
): Array<{ readonly start: number; readonly end: number }> {
  const ranges: Array<{ readonly start: number; readonly end: number }> = [];
  const lines = getMarkdownLines(markdown);
  const visit = (node: MarkdownNode): void => {
    const position = node.position;
    if (
      node.type === 'code' &&
      position !== undefined &&
      typeof position.start.offset === 'number' &&
      typeof position.end.offset === 'number'
    ) {
      const startLine = lines[position.start.line === undefined ? -1 : position.start.line - 1];
      const endLine = lines[position.end.line === undefined ? -1 : position.end.line - 1];
      const openingFence = markdown.slice(position.start.offset).match(/^(`{3,}|~{3,})/);
      if (openingFence !== null && openingFence !== undefined && startLine !== undefined) {
        const fence = openingFence[1] ?? '';
        const closingFencePattern = new RegExp(
          `^[ \\t>+*\\-0-9.)]*${fence[0] === '~' ? '~' : '`'}{${fence.length},}[ \\t]*$`,
        );
        const hasClosingFence =
          endLine !== undefined &&
          endLine.start > startLine.start &&
          closingFencePattern.test(endLine.text);
        const firstContentLine = lines[position.start.line ?? 0];
        const start = firstContentLine?.start ?? position.end.offset;
        const previousLine = hasClosingFence ? lines[(position.end.line ?? 0) - 2] : undefined;
        const end = hasClosingFence
          ? Math.max(start, previousLine?.contentEnd ?? start)
          : position.end.offset;
        ranges.push({ start, end });
      } else {
        ranges.push({ start: position.start.offset, end: position.end.offset });
      }
    }
    node.children?.forEach(visit);
  };
  visit(parseMarkdownTree(markdown));
  return ranges;
}

function getMarkdownLines(markdown: string): Array<{
  readonly start: number;
  readonly contentEnd: number;
  readonly text: string;
}> {
  const lines: Array<{ start: number; contentEnd: number; text: string }> = [];
  const lineEndingPattern = /\r\n|\n|\r/g;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = lineEndingPattern.exec(markdown)) !== null) {
    const contentEnd = match.index;
    lines.push({ start, contentEnd, text: markdown.slice(start, contentEnd) });
    start = contentEnd + match[0].length;
  }
  lines.push({ start, contentEnd: markdown.length, text: markdown.slice(start) });
  return lines;
}

export function getCodeBlockSourceLineOffsets(
  markdown: string,
  sourceStart: number,
  renderedLines: readonly string[],
): number[] {
  const sourceLines = getMarkdownLines(markdown);
  let lineIndex = sourceLines.findIndex((line) => line.start >= sourceStart);
  if (lineIndex < 0) return [];
  return renderedLines.map((renderedLine) => {
    const sourceLine = sourceLines[lineIndex];
    lineIndex += 1;
    if (sourceLine === undefined || renderedLine === '') return sourceLine?.start ?? sourceStart;
    const localOffset = sourceLine.text.indexOf(renderedLine);
    return localOffset < 0 ? sourceLine.start : sourceLine.start + localOffset;
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

function findSourceCharacter(
  renderedCharacter: string,
  sourceMap: readonly SourceCharacter[],
  sourceIndex: number,
): { readonly character: SourceCharacter; readonly index: number } | null {
  const normalized = renderedCharacter === '\u00a0' ? ' ' : renderedCharacter;
  while (
    sourceIndex < sourceMap.length &&
    sourceMap[sourceIndex]?.char === '\n' &&
    normalized !== '\n'
  ) {
    sourceIndex += 1;
  }
  for (let index = sourceIndex; index < Math.min(sourceMap.length, sourceIndex + 12); index += 1) {
    const character = sourceMap[index];
    if (character?.char === normalized) return { character, index };
  }
  const fallback = sourceMap[sourceIndex];
  return fallback === undefined ? null : { character: fallback, index: sourceIndex };
}

function findSourceIndexAtOrAfter(sourceMap: readonly SourceCharacter[], offset: number): number {
  let low = 0;
  let high = sourceMap.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((sourceMap[middle]?.start ?? Number.POSITIVE_INFINITY) < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function appendInline(source: string, sourceStart: number, target: SourceCharacter[]): void {
  let cursor = 0;
  while (cursor < source.length) {
    const remainder = source.slice(cursor);
    const image = remainder.match(/^!\[([^\]]*)\]\([^)]*\)/);
    if (image !== null) {
      cursor += image[0].length;
      continue;
    }
    const link = remainder.match(/^\[([^\]]+)\]\([^)]*\)/);
    if (link !== null) {
      const label = link[1] ?? '';
      const labelStart = cursor + (link[0]?.indexOf(label) ?? 0);
      appendInline(label, sourceStart + labelStart, target);
      cursor += link[0].length;
      continue;
    }
    const code = remainder.match(/^(`+)(.+?)\1/);
    if (code !== null) {
      const inner = code[2] ?? '';
      const innerStart = cursor + (code[0]?.indexOf(inner) ?? 0);
      appendLiteral(inner, sourceStart + innerStart, target);
      cursor += code[0].length;
      continue;
    }
    const emphasis = remainder.match(/^(\*\*|__|~~|\*|_)(.+?)\1/);
    if (emphasis !== null) {
      const inner = emphasis[2] ?? '';
      const innerStart = cursor + (emphasis[0]?.indexOf(inner) ?? 0);
      appendInline(inner, sourceStart + innerStart, target);
      cursor += emphasis[0].length;
      continue;
    }
    if (remainder.startsWith('\\') && remainder.length > 1) {
      const escaped = String.fromCodePoint(remainder.codePointAt(1) ?? 0);
      appendCharacter(
        escaped,
        sourceStart + cursor + 1,
        sourceStart + cursor + 1 + escaped.length,
        target,
      );
      cursor += 1 + escaped.length;
      continue;
    }
    const character = String.fromCodePoint(source.codePointAt(cursor) ?? 0);
    appendCharacter(
      character,
      sourceStart + cursor,
      sourceStart + cursor + character.length,
      target,
    );
    cursor += character.length;
  }
}

function appendLiteral(source: string, sourceStart: number, target: SourceCharacter[]): void {
  for (let index = 0; index < source.length;) {
    const character = String.fromCodePoint(source.codePointAt(index) ?? 0);
    appendCharacter(character, sourceStart + index, sourceStart + index + character.length, target);
    index += character.length;
  }
}

function appendCharacter(
  char: string,
  start: number,
  end: number,
  target: SourceCharacter[],
): void {
  if (char !== '') target.push({ char, start, end });
}

function isTableHeader(line: string, separator: string): boolean {
  return line.includes('|') && tableSeparatorPattern.test(separator);
}

function findTableEnd(lines: readonly string[], start: number): number {
  let index = start + 2;
  while (
    index < lines.length &&
    (lines[index] ?? '').trim() !== '' &&
    (lines[index] ?? '').includes('|')
  ) {
    index += 1;
  }
  return index;
}

export function getMarkdownTableRanges(
  markdown: string,
): Array<{ readonly start: number; readonly end: number }> {
  const lines = markdown.split('\n');
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }

  const ranges: Array<{ readonly start: number; readonly end: number }> = [];
  let index = 0;
  while (index < lines.length) {
    if (!isTableHeader(lines[index] ?? '', lines[index + 1] ?? '')) {
      index += 1;
      continue;
    }
    const endLine = findTableEnd(lines, index);
    const lastLine = Math.max(index, endLine - 1);
    const start = lineStarts[index] ?? markdown.length;
    const end = (lineStarts[lastLine] ?? start) + (lines[lastLine]?.length ?? 0);
    ranges.push({ start, end });
    index = endLine;
  }
  return ranges;
}

function appendTableRow(line: string, lineStart: number, target: SourceCharacter[]): void {
  const cells = splitTableCells(line);
  for (const cell of cells) {
    appendInline(cell.text, lineStart + cell.start, target);
  }
}

function splitTableCells(line: string): Array<{ readonly text: string; readonly start: number }> {
  const cells: Array<{ readonly text: string; readonly start: number }> = [];
  let cellStart = line.startsWith('|') ? 1 : 0;
  for (let index = cellStart; index <= line.length; index += 1) {
    if (index !== line.length && line[index] !== '|') continue;
    const raw = line.slice(cellStart, index);
    const leadingTrim = raw.search(/\S|$/);
    const text = raw.trim();
    if (text !== '') cells.push({ text, start: cellStart + leadingTrim });
    cellStart = index + 1;
  }
  return cells;
}

function stripClosingHeadingMarker(value: string): {
  readonly text: string;
  readonly leadingTrim: number;
} {
  const withoutClosingMarker = value.replace(/\s+#+\s*$/, '');
  const leadingTrim = value.length - value.trimStart().length;
  return { text: withoutClosingMarker.trim(), leadingTrim };
}
