/**
 * Keeps Markdown image syntax from becoming a network-backed `<img>` in a
 * read-only document. The replacement is length-preserving so source offsets
 * still refer to the original Markdown.
 */
export function makeMarkdownImagesInert(markdown: string): string {
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
      return makeInlineMarkdownImagesInert(line);
    })
    .join('\n');
}

function makeInlineMarkdownImagesInert(line: string): string {
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
      isUnescapedImageStart(characters, index)
    ) {
      characters[index] = '\\';
    }
  }
  return characters.join('');
}

function isUnescapedImageStart(characters: readonly string[], index: number): boolean {
  let precedingBackslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && characters[cursor] === '\\'; cursor -= 1) {
    precedingBackslashes += 1;
  }
  return precedingBackslashes % 2 === 0;
}
