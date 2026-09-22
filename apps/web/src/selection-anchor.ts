import type { SelectionAnchor, SelectionRect } from './feedback-types.js';

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

function elementSourceOffset(element: Element, offset: number): number | null {
  const children = Array.from(element.childNodes);
  const target = offset === children.length ? children.at(-1) : children[offset];
  const mapped =
    target instanceof Element
      ? offset === children.length
        ? (target.querySelector('[data-source-end]') ?? target.closest('[data-source-end]'))
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
  if (range.toString() !== anchor.quote) return false;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function locateText(root: HTMLElement, target: number): { node: Text; offset: number } | null {
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
