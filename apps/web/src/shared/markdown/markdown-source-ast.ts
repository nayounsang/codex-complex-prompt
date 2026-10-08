import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';
import { unified } from 'unified';
import { getMarkdownAttachmentId } from './attachment-path.js';

export interface MarkdownAttachmentImageRange {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

export interface MarkdownImageSourceRange {
  readonly start: number;
  readonly end: number;
}

export function getMarkdownAttachmentImageRanges(markdown: string): MarkdownAttachmentImageRange[] {
  const ranges: MarkdownAttachmentImageRange[] = [];
  const tree = parseMarkdownTree(markdown);
  visit(tree, (node) => {
    if (node.type !== 'image' || node.position === undefined) return;
    const id = getMarkdownAttachmentId(node.url);
    const { start, end } = node.position;
    if (id !== null && typeof start.offset === 'number' && typeof end.offset === 'number') {
      ranges.push({ id, start: start.offset, end: end.offset });
    }
  });

  return ranges;
}

export function countMarkdownImageOccurrences(
  markdown: string,
  targets: readonly string[],
): Map<string, number> {
  const targetSet = new Set(targets);
  const occurrences = new Map<string, number>();
  if (targetSet.size === 0) return occurrences;

  const tree = parseMarkdownTree(markdown);
  visit(tree, (node) => {
    if (node.type !== 'image' || node.position === undefined) return;
    const { start, end } = node.position;
    if (typeof start.offset !== 'number' || typeof end.offset !== 'number') return;
    const imageMarkdown = markdown.slice(start.offset, end.offset);
    if (targetSet.has(imageMarkdown))
      occurrences.set(imageMarkdown, (occurrences.get(imageMarkdown) ?? 0) + 1);
  });
  return occurrences;
}

export function getEmptyImageSourceRanges(markdown: string): MarkdownImageSourceRange[] {
  const ranges: MarkdownImageSourceRange[] = [];
  visit(parseMarkdownTree(markdown), (node) => {
    if (node.type !== 'image' || node.url !== '') return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      ranges.push({ start, end });
    }
  });
  return ranges;
}

function parseMarkdownTree(markdown: string) {
  return unified().use(remarkParse).use(remarkGfm).parse(markdown);
}

export function getCodeBlockSourceRanges(
  markdown: string,
): Array<{ readonly start: number; readonly end: number }> {
  const ranges: Array<{ readonly start: number; readonly end: number }> = [];
  const lines = getMarkdownLines(markdown);
  visit(parseMarkdownTree(markdown), (node) => {
    if (node.type !== 'code') return;
    const position = node.position;
    if (
      position === undefined ||
      typeof position.start.offset !== 'number' ||
      typeof position.end.offset !== 'number'
    ) {
      return;
    }
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
  });
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
