const tableSeparatorPattern = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$/;

export function isMarkdownTableHeader(line: string, separator: string): boolean {
  return line.includes('|') && tableSeparatorPattern.test(separator);
}

export function findMarkdownTableEnd(lines: readonly string[], start: number): number {
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
    if (!isMarkdownTableHeader(lines[index] ?? '', lines[index + 1] ?? '')) {
      index += 1;
      continue;
    }
    const endLine = findMarkdownTableEnd(lines, index);
    const lastLine = Math.max(index, endLine - 1);
    const start = lineStarts[index] ?? markdown.length;
    const end = (lineStarts[lastLine] ?? start) + (lines[lastLine]?.length ?? 0);
    ranges.push({ start, end });
    index = endLine;
  }
  return ranges;
}
