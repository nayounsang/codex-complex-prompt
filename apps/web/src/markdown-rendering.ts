import { createAttachmentImageUrl } from './attachment-image-url.js';

/**
 * Keeps Markdown image syntax from becoming a network-backed `<img>` in a
 * read-only document. The replacement is length-preserving so source offsets
 * still refer to the original Markdown.
 */
export function makeMarkdownImagesInert(
  markdown: string,
  attachment?: { readonly baseUrl: string; readonly token: string; readonly refreshKey: number },
): string {
  const lines = markdown.split('\n');
  let activeFence: { readonly character: '`' | '~'; readonly length: number } | null = null;

  return lines
    .map((line) => {
      const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (activeFence !== null) {
        if (
          fence !== null &&
          fence[1]?.[0] === activeFence.character &&
          (fence[1]?.length ?? 0) >= activeFence.length
        ) {
          activeFence = null;
        }
        return line;
      }
      if (fence !== null) {
        const marker = fence[1] ?? '';
        activeFence = { character: marker[0] as '`' | '~', length: marker.length };
        return line;
      }
      const previewLine =
        attachment === undefined ? line : rewriteAttachmentImagePaths(line, attachment);
      return makeInlineMarkdownImagesInert(previewLine, attachment);
    })
    .join('\n');
}

function makeInlineMarkdownImagesInert(
  line: string,
  attachment?: { readonly baseUrl: string; readonly token: string; readonly refreshKey: number },
): string {
  const characters = [...line];
  let inlineCodeFenceLength = 0;
  for (let index = 0; index < characters.length; index += 1) {
    if (characters[index] === '`') {
      let end = index;
      while (characters[end] === '`') end += 1;
      const length = end - index;
      if (inlineCodeFenceLength === 0) inlineCodeFenceLength = length;
      else if (inlineCodeFenceLength === length) inlineCodeFenceLength = 0;
      index = end - 1;
      continue;
    }
    if (
      inlineCodeFenceLength === 0 &&
      characters[index] === '!' &&
      characters[index + 1] === '[' &&
      isUnescapedImageStart(characters, index) &&
      !isAllowedAttachmentImage(characters, index, attachment)
    ) {
      characters[index] = '\\';
    }
  }
  return characters.join('');
}

function isAllowedAttachmentImage(
  characters: readonly string[],
  index: number,
  attachment:
    | { readonly baseUrl: string; readonly token: string; readonly refreshKey: number }
    | undefined,
): boolean {
  if (attachment === undefined) return false;
  const match = /^!\[[^\]]*\]\(([^)]+)\)/.exec(characters.slice(index).join(''));
  const source = match?.[1];
  if (source === undefined) return false;
  try {
    const url = new URL(source);
    const base = new URL(attachment.baseUrl);
    return (
      url.origin === base.origin &&
      url.pathname.startsWith(`${base.pathname}/`) &&
      /^\/[0-9a-f-]{36}\.png$/i.test(url.pathname.slice(base.pathname.length)) &&
      url.searchParams.get('token') === attachment.token &&
      (url.searchParams.size === 1 ||
        (url.searchParams.size === 2 &&
          url.searchParams.get('refresh') === String(attachment.refreshKey)))
    );
  } catch {
    return false;
  }
}

function rewriteAttachmentImagePaths(
  line: string,
  attachment: { readonly baseUrl: string; readonly token: string; readonly refreshKey: number },
): string {
  let rewritten = '';
  let inlineCodeFenceLength = 0;
  for (let index = 0; index < line.length;) {
    if (line[index] === '`') {
      let end = index;
      while (line[end] === '`') end += 1;
      const length = end - index;
      if (inlineCodeFenceLength === 0) inlineCodeFenceLength = length;
      else if (inlineCodeFenceLength === length) inlineCodeFenceLength = 0;
      rewritten += line.slice(index, end);
      index = end;
      continue;
    }
    if (inlineCodeFenceLength === 0 && line.startsWith('![', index)) {
      const match = /^!\[([^\]]*)\]\(\.complex-prompt\/attachments\/([0-9a-f-]{36})\.png\)/i.exec(
        line.slice(index),
      );
      if (match !== null) {
        rewritten += `![${match[1]}](${createAttachmentImageUrl(attachment.baseUrl, match[2] ?? '', attachment.token, attachment.refreshKey)})`;
        index += match[0].length;
        continue;
      }
    }
    rewritten += line[index];
    index += 1;
  }
  return rewritten;
}

function isUnescapedImageStart(characters: readonly string[], index: number): boolean {
  let precedingBackslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && characters[cursor] === '\\'; cursor -= 1) {
    precedingBackslashes += 1;
  }
  return precedingBackslashes % 2 === 0;
}
