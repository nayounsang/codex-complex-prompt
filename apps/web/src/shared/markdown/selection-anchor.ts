import type { SelectionAnchor, SelectionRect } from './types.js';
import {
  getMappedSourceOffset,
  getMarkdownTableRanges,
  locateMappedText,
} from './markdown-source-map.js';

export function getSelectionAnchor(root: HTMLElement): SelectionAnchor | null {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const start = textOffset(root, range.startContainer, range.startOffset);
  const end = textOffset(root, range.endContainer, range.endOffset);
  if (start >= end) return null;
  const measuredRect =
    typeof range.getBoundingClientRect === 'function'
      ? range.getBoundingClientRect()
      : new DOMRect();
  const startElement =
    (range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement) ?? root;
  const fallbackElement = startElement.closest('[data-source-start]') ?? root;
  const rect =
    measuredRect.width === 0 && measuredRect.height === 0
      ? fallbackElement.getBoundingClientRect()
      : measuredRect;
  return { quote: selection.toString(), start, end, rect: toSelectionRect(rect) };
}

export function getTableSelectionAnchor(
  root: HTMLElement,
  markdown: string,
): SelectionAnchor | null {
  const selectedCell = root.querySelector<HTMLElement>('.milkdown-table-block .selectedCell');
  const tableBlock = selectedCell?.closest<HTMLElement>('.milkdown-table-block');
  if (tableBlock === null || tableBlock === undefined) return null;

  const tableBlocks = Array.from(root.querySelectorAll('.milkdown-table-block'));
  const tableIndex = tableBlocks.indexOf(tableBlock);
  const tableRange = getMarkdownTableRanges(markdown)[tableIndex];
  if (tableRange === undefined) return null;

  return {
    quote: markdown.slice(tableRange.start, tableRange.end),
    start: tableRange.start,
    end: tableRange.end,
    rect: toSelectionRect(tableBlock.getBoundingClientRect()),
  };
}

export function getCodeBlockSelectionAnchor(
  root: HTMLElement,
  markdown: string,
): SelectionAnchor | null {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const startBlock = closestCodeBlock(range.startContainer);
  const endBlock = closestCodeBlock(range.endContainer);
  if (startBlock === null || startBlock !== endBlock) return null;

  const start = Number(startBlock.dataset['codeSourceStart']);
  const end = Number(startBlock.dataset['codeSourceEnd']);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return null;
  return {
    quote: markdown.slice(start, end),
    start,
    end,
    rect: toSelectionRect(startBlock.getBoundingClientRect()),
  };
}

function toSelectionRect(rect: DOMRect): SelectionRect {
  return {
    x: rect.x,
    y: rect.y,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function textOffset(root: HTMLElement, container: Node, offset: number): number {
  const codeOffset = codeBlockTextOffset(container, offset);
  if (codeOffset !== null) return codeOffset;
  const mappedOffset = getMappedSourceOffset(root, container, offset);
  if (mappedOffset !== null) return mappedOffset;
  if (container.nodeType === Node.TEXT_NODE) {
    const mapped = (container.parentElement?.closest('[data-source-start]') ?? null)?.getAttribute(
      'data-source-start',
    );
    if (mapped !== null) return Number(mapped) + offset;
  }
  if (container.nodeType === Node.ELEMENT_NODE) {
    const mappedOffset = elementSourceOffset(container as Element, offset);
    if (mappedOffset !== null) return mappedOffset;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current = walker.nextNode();
  while (current !== null) {
    if (current === container) return total + offset;
    total += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return total;
}

function codeBlockTextOffset(container: Node, offset: number): number | null {
  const element =
    container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
  const codeBlock = element?.closest<HTMLElement>('.milkdown-code-block[data-code-source-start]');
  const codeContent = codeBlock?.querySelector<HTMLElement>('.cm-content');
  if (
    codeBlock === null ||
    codeBlock === undefined ||
    codeContent === null ||
    codeContent === undefined
  ) {
    return null;
  }
  if (!codeContent.contains(container)) return null;
  const sourceStart = Number(codeBlock.dataset['codeSourceStart']);
  const range = document.createRange();
  range.selectNodeContents(codeContent);
  range.setEnd(container, offset);
  return sourceStart + range.toString().length;
}

function closestCodeBlock(container: Node): HTMLElement | null {
  const element =
    container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement;
  return element?.closest<HTMLElement>('.milkdown-code-block[data-code-source-start]') ?? null;
}

function elementSourceOffset(element: Element, offset: number): number | null {
  const children = Array.from(element.childNodes);
  const target = offset === children.length ? children.at(-1) : children[offset];
  const mapped =
    target instanceof Element
      ? offset === children.length
        ? (Array.from(target.querySelectorAll('[data-source-end]')).at(-1) ??
          (target.matches('[data-source-end]') ? target : target.closest('[data-source-end]')))
        : (target.querySelector('[data-source-start]') ?? target.closest('[data-source-start]'))
      : target?.parentElement?.closest(
          offset === children.length ? '[data-source-end]' : '[data-source-start]',
        );
  if (mapped === null || mapped === undefined) return null;
  const attribute = offset === children.length ? 'data-source-end' : 'data-source-start';
  const value = mapped.getAttribute(attribute);
  return value === null ? null : Number(value);
}

export function restoreSelectionAnchor(root: HTMLElement, anchor: SelectionAnchor): boolean {
  const range = document.createRange();
  const start = locateText(root, anchor.start);
  const end = locateText(root, anchor.end);
  if (start === null || end === null) return false;
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  if (range.collapsed) return false;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function locateText(root: HTMLElement, target: number): { node: Text; offset: number } | null {
  const mapped = locateMappedText(root, target);
  if (mapped !== null) return mapped;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current = walker.nextNode();
  while (current !== null) {
    const mappedStart = (
      current.parentElement?.closest('[data-source-start]') ?? null
    )?.getAttribute('data-source-start');
    const mappedEnd = (current.parentElement?.closest('[data-source-end]') ?? null)?.getAttribute(
      'data-source-end',
    );
    if (mappedStart !== null && mappedEnd !== null) {
      const start = Number(mappedStart);
      const end = Number(mappedEnd);
      if (target <= end) return { node: current as Text, offset: Math.max(0, target - start) };
      current = walker.nextNode();
      continue;
    }
    const length = current.textContent?.length ?? 0;
    if (target <= total + length) return { node: current as Text, offset: target - total };
    total += length;
    current = walker.nextNode();
  }
  return null;
}
