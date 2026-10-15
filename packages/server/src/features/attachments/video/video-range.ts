import type { Range } from 'range-parser';
import rangeParser from 'range-parser';

export function parseVideoRange(
  header: string | undefined,
  length: number,
): Readonly<Range> | null {
  if (header === undefined) return { start: 0, end: length - 1 };
  if (length === 0) return null;

  const ranges = rangeParser(length, header);

  if (typeof ranges === 'number' || ranges.type !== 'bytes' || ranges.length !== 1) return null;
  const range = ranges[0];
  if (range === undefined) return null;
  return { start: range.start, end: range.end };
}

export function isVideoExtension(extension: string): boolean {
  return extension === 'mp4' || extension === 'mov' || extension === 'webm';
}
