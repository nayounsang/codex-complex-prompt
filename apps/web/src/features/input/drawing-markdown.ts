export interface MarkdownDrawingReference {
  readonly id: string;
  readonly label: string;
}

const drawingImagePattern =
  /!\[([^\]]*)\]\(\.complex-prompt\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.png\)/gi;

export function findMarkdownDrawingReferences(markdown: string): MarkdownDrawingReference[] {
  const drawingsById = new Map<string, MarkdownDrawingReference>();
  transformMarkdownBodyLines(markdown, (line) => {
    for (const match of line.matchAll(drawingImagePattern)) {
      const id = match[2];
      if (id !== undefined && !drawingsById.has(id.toLowerCase())) {
        drawingsById.set(id.toLowerCase(), {
          id,
          label: match[1]?.trim() || 'Drawing',
        });
      }
    }
    return line;
  });
  return [...drawingsById.values()];
}

export function removeMarkdownDrawingReferences(markdown: string, id: string): string {
  const normalizedId = id.toLowerCase();
  const updatedMarkdown = transformMarkdownBodyLines(markdown, (line) => {
    const updatedLine = line.replace(
      drawingImagePattern,
      (image, _label: string, imageId: string) =>
        imageId.toLowerCase() === normalizedId ? '' : image,
    );
    return updatedLine.trim() === '' ? '' : updatedLine;
  });
  return updatedMarkdown.replace(/\n{3,}/g, '\n\n');
}

function transformMarkdownBodyLines(markdown: string, transform: (line: string) => string): string {
  let activeFence: { readonly character: '`' | '~'; readonly length: number } | null = null;

  return markdown
    .split('\n')
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
      if (/^ {0,3}>/.test(line) || /^(?: {4,}|\t)/.test(line)) return line;
      return transform(line);
    })
    .join('\n');
}
