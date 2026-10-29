import { MERMAID_UI_REPLACEMENT_MODEL } from '@codex-complex-prompt/milkdown-plugins/shared';

export const MARKDOWN_UI_REPLACEMENT_MODEL = {
  drawing: {
    kind: 'drawing',
    markdown: '![label](.complex-prompt/attachments/<uuid>.png)',
    renderedUi: 'drawing image with edit and delete actions',
    persistedMarkdown: 'the same Markdown image reference',
    fallbackLabel: 'Drawing',
  },
  video: {
    kind: 'video',
    markdown: 'standalone ![](http-or-https-video-url)',
    renderedUi: 'video preview mounted beside its source paragraph',
    persistedMarkdown: 'the original Markdown image reference',
    mountClassName: 'video-embed-mount',
    standaloneMarkdown: (source: string): string => `![](${source})`,
  },
  mermaid: {
    ...MERMAID_UI_REPLACEMENT_MODEL,
    markdown: 'fenced code block with mermaid info string',
    renderedUi: 'diagram preview with canvas and source editor',
    persistedMarkdown: 'the Mermaid code fence',
  },
  mediaPlaceholder: {
    kind: 'media-placeholder',
    markdown: '![]() with a temporary image alt marker',
    renderedUi: 'accessible media picker button and upload state',
    persistedMarkdown: 'the final image or video attachment reference',
    markerPrefix: 'media-placeholder-',
    pendingPrefix: 'media-upload-pending-',
  },
} as const;

export type MarkdownUiReplacementKind = keyof typeof MARKDOWN_UI_REPLACEMENT_MODEL;
