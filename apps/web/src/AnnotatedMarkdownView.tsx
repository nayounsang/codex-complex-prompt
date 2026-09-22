import { useRef } from 'react';

import { getSelectionAnchor } from './selection-anchor.js';
import type { FeedbackAnnotation, SelectionAnchor } from './feedback-types.js';

interface AnnotatedMarkdownViewProps {
  readonly markdown: string;
  readonly annotations: readonly FeedbackAnnotation[];
  readonly onSelection: (selection: SelectionAnchor | null) => void;
}

interface MarkdownBlock {
  readonly type: 'heading' | 'paragraph' | 'quote' | 'unordered-list' | 'ordered-list' | 'code';
  readonly level?: number;
  readonly content: string;
  readonly contentStart: number;
}

interface SourcePart {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

interface FeedbackRange {
  readonly start: number;
  readonly end: number;
  readonly id: string;
}

export function AnnotatedMarkdownView({
  markdown,
  annotations,
  onSelection,
}: AnnotatedMarkdownViewProps): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null);
  const ranges = annotations
    .filter(
      (annotation) =>
        annotation.scope === 'selection' &&
        annotation.start !== undefined &&
        annotation.end !== undefined &&
        markdown.slice(annotation.start, annotation.end) === annotation.quote,
    )
    .map((annotation) => ({
      start: annotation.start as number,
      end: annotation.end as number,
      id: annotation.id,
    }))
    .sort((left, right) => left.start - right.start);
  const blocks = parseMarkdown(markdown);

  return (
    <article
      ref={rootRef}
      className="annotated-markdown markdown-surface markdown-content"
      data-testid="annotated-markdown"
      aria-label="Markdown with feedback annotations"
      onMouseUp={() =>
        onSelection(rootRef.current === null ? null : getSelectionAnchor(rootRef.current))
      }
    >
      {blocks.map((block, index) => (
        <MarkdownBlockView key={`${block.contentStart}-${index}`} block={block} ranges={ranges} />
      ))}
    </article>
  );
}

function MarkdownBlockView({
  block,
  ranges,
}: {
  readonly block: MarkdownBlock;
  readonly ranges: readonly FeedbackRange[];
}): React.JSX.Element {
  if (block.type === 'code') {
    return (
      <pre className="markdown-code-block">
        {renderMappedText(block.content, block.contentStart, ranges)}
      </pre>
    );
  }
  const content = renderMappedText(block.content, block.contentStart, ranges);
  if (block.type === 'heading') {
    const Heading = `h${block.level ?? 1}` as keyof React.JSX.IntrinsicElements;
    return <Heading>{content}</Heading>;
  }
  if (block.type === 'quote') return <blockquote>{content}</blockquote>;
  if (block.type === 'unordered-list')
    return (
      <ul>
        <li>{content}</li>
      </ul>
    );
  if (block.type === 'ordered-list')
    return (
      <ol>
        <li>{content}</li>
      </ol>
    );
  return <p>{content}</p>;
}

function renderMappedText(
  source: string,
  sourceStart: number,
  ranges: readonly FeedbackRange[],
): React.JSX.Element[] {
  return parseInline(source, sourceStart).map((part, index) => {
    const parts: React.JSX.Element[] = [];
    let cursor = 0;
    const matchingRanges = ranges.filter(
      (range) => range.start < part.end && range.end > part.start,
    );
    if (matchingRanges.length === 0) {
      return (
        <span
          key={`${part.start}-${index}`}
          data-source-start={part.start}
          data-source-end={part.end}
        >
          {part.text}
        </span>
      );
    }
    for (const range of matchingRanges) {
      const selectedStart = Math.max(part.start, range.start);
      const selectedEnd = Math.min(part.end, range.end);
      const beforeEnd = selectedStart - part.start;
      if (beforeEnd > cursor) {
        parts.push(
          <span
            key={`${part.start}-${index}-before-${cursor}`}
            data-source-start={part.start + cursor}
            data-source-end={part.start + beforeEnd}
          >
            {part.text.slice(cursor, beforeEnd)}
          </span>,
        );
      }
      if (selectedEnd > selectedStart) {
        parts.push(
          <mark
            key={`${range.id}-${selectedStart}`}
            data-feedback-id={range.id}
            data-source-start={selectedStart}
            data-source-end={selectedEnd}
            className="feedback-highlight"
          >
            {part.text.slice(selectedStart - part.start, selectedEnd - part.start)}
          </mark>,
        );
      }
      cursor = Math.max(cursor, selectedEnd - part.start);
    }
    if (cursor < part.text.length) {
      parts.push(
        <span
          key={`${part.start}-${index}-after-${cursor}`}
          data-source-start={part.start + cursor}
          data-source-end={part.end}
        >
          {part.text.slice(cursor)}
        </span>,
      );
    }
    return <span key={`${part.start}-${index}`}>{parts}</span>;
  });
}

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const lines = markdown.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    const start = offsets[index] ?? 0;
    if (/^\s*```/.test(line)) {
      const endFence = lines.findIndex(
        (candidate, candidateIndex) => candidateIndex > index && /^\s*```/.test(candidate),
      );
      const contentStart = offsets[index + 1] ?? markdown.length;
      const contentEnd = endFence === -1 ? markdown.length : (offsets[endFence] ?? markdown.length);
      blocks.push({
        type: 'code',
        content: markdown.slice(contentStart, contentEnd),
        contentStart,
      });
      index = endFence === -1 ? lines.length : endFence + 1;
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
    if (heading !== null) {
      const level = heading[1] ?? '';
      const content = heading[2] ?? '';
      blocks.push({
        type: 'heading',
        level: level.length,
        content,
        contentStart: start + line.indexOf(content),
      });
      index += 1;
      continue;
    }
    const list = line.match(/^\s*([-*+] |\d+[.] )(.+)$/);
    if (list !== null) {
      const marker = list[1] ?? '';
      const content = list[2] ?? '';
      blocks.push({
        type: /^\d/.test(marker) ? 'ordered-list' : 'unordered-list',
        content,
        contentStart: start + line.indexOf(content),
      });
      index += 1;
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote !== null) {
      const content = quote[1] ?? '';
      blocks.push({
        type: 'quote',
        content,
        contentStart: start + line.indexOf(content),
      });
      index += 1;
      continue;
    }
    const paragraphStart = index;
    while (
      index + 1 < lines.length &&
      (lines[index + 1] ?? '').trim() !== '' &&
      !/^\s*(#{1,6})\s+/.test(lines[index + 1] ?? '') &&
      !/^\s*([-*+] |\d+[.] |>|```)/.test(lines[index + 1] ?? '')
    ) {
      index += 1;
    }
    const paragraphEnd = offsets[index] ?? start;
    blocks.push({
      type: 'paragraph',
      content: markdown.slice(
        offsets[paragraphStart] ?? start,
        paragraphEnd + (lines[index]?.length ?? 0),
      ),
      contentStart: offsets[paragraphStart] ?? start,
    });
    index += 1;
  }
  return blocks;
}

function parseInline(source: string, sourceStart: number): SourcePart[] {
  const parts: SourcePart[] = [];
  let cursor = 0;
  const push = (text: string, start: number, end: number): void => {
    if (text !== '') parts.push({ text, start: sourceStart + start, end: sourceStart + end });
  };
  while (cursor < source.length) {
    const link = source.slice(cursor).match(/^!?\[([^\]]+)\]\([^)]*\)/);
    const emphasis = source.slice(cursor).match(/^(\*\*|__|\*|_|`)(.+?)\1/);
    if (link !== null) {
      const label = link[1] ?? '';
      const full = link[0] ?? '';
      const labelOffset = full.indexOf(label);
      push(label, cursor + labelOffset, cursor + labelOffset + label.length);
      cursor += full.length;
    } else if (emphasis !== null) {
      const inner = emphasis[2] ?? '';
      const full = emphasis[0] ?? '';
      const innerOffset = full.indexOf(inner);
      push(inner, cursor + innerOffset, cursor + innerOffset + inner.length);
      cursor += full.length;
    } else {
      const next = source.slice(cursor + 1).search(/[\[\]`*_]/);
      const end = next === -1 ? source.length : cursor + 1 + next;
      push(source.slice(cursor, end), cursor, end);
      cursor = end;
    }
  }
  return parts;
}
