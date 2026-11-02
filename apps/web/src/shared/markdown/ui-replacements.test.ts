import { describe, expect, it } from 'vitest';

import { MARKDOWN_UI_REPLACEMENT_MODEL } from './ui-replacements.js';

describe('Markdown UI replacement model', () => {
  it('maps drawings, Mermaid blocks, and media placeholders to their editor UI and saved Markdown', () => {
    expect(Object.keys(MARKDOWN_UI_REPLACEMENT_MODEL)).toEqual([
      'drawing',
      'mermaid',
      'mediaPlaceholder',
    ]);
    expect(MARKDOWN_UI_REPLACEMENT_MODEL.drawing).toMatchObject({
      markdown: '![label](.complex-prompt/attachments/<uuid>.png)',
      persistedMarkdown: 'the same Markdown image reference',
    });
    expect(MARKDOWN_UI_REPLACEMENT_MODEL.mermaid.language).toBe('mermaid');
    expect(MARKDOWN_UI_REPLACEMENT_MODEL.mediaPlaceholder.markerPrefix).toBe('media-placeholder-');
    expect(MARKDOWN_UI_REPLACEMENT_MODEL.mediaPlaceholder.pendingPrefix).toBe(
      'media-upload-pending-',
    );
  });
});
