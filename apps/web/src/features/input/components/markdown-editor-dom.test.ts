import { describe, expect, it } from 'vitest';

import {
  getDrawingIdFromImage,
  replaceAttachmentImageUrls,
  syncMediaPlaceholderAccessibility,
} from './markdown-editor-dom.js';
import { INERT_MEDIA_IMAGE_SRC } from '../../../shared/markdown/media-embeds.js';

function createPlaceholderRoot(alt = ''): {
  root: HTMLDivElement;
  paragraph: HTMLParagraphElement;
} {
  const root = document.createElement('div');
  const proseMirror = document.createElement('div');
  proseMirror.className = 'ProseMirror';
  const paragraph = document.createElement('p');
  const image = document.createElement('img');
  image.src = '';
  image.alt = alt;
  const separator = document.createElement('img');
  separator.className = 'ProseMirror-separator';
  const trailingBreak = document.createElement('br');
  trailingBreak.className = 'ProseMirror-trailingBreak';
  paragraph.append(image, separator, document.createTextNode(' '), trailingBreak);
  proseMirror.append(paragraph);
  root.append(proseMirror);
  return { root, paragraph };
}

describe('syncMediaPlaceholderAccessibility', () => {
  it('exposes a host media placeholder as an accessible media button', () => {
    const { root, paragraph } = createPlaceholderRoot('media-placeholder-123');

    syncMediaPlaceholderAccessibility(root, false);

    expect(paragraph).toMatchObject({ tabIndex: 0 });
    expect(paragraph).toHaveAttribute('role', 'button');
    expect(paragraph).toHaveAttribute('aria-label', 'Add media');
  });

  it('leaves a Markdown empty image destination to the media renderer', () => {
    const { root, paragraph } = createPlaceholderRoot();

    syncMediaPlaceholderAccessibility(root, false);

    expect(paragraph).not.toHaveAttribute('data-media-placeholder');
    expect(paragraph).not.toHaveAttribute('role');
  });

  it('marks an uploading placeholder disabled and removes its action in read-only mode', () => {
    const { root, paragraph } = createPlaceholderRoot('media-upload-pending-123');

    syncMediaPlaceholderAccessibility(root, false);
    expect(paragraph).toHaveAttribute('aria-disabled', 'true');
    expect(paragraph).toHaveAttribute('aria-label', 'Uploading media');

    syncMediaPlaceholderAccessibility(root, true);
    expect(paragraph).not.toHaveAttribute('data-media-placeholder');
    expect(paragraph).not.toHaveAttribute('role');
  });

  it('does not expose an empty image inside a paragraph with other content', () => {
    const { root, paragraph } = createPlaceholderRoot();
    paragraph.append(document.createTextNode('Caption'));

    syncMediaPlaceholderAccessibility(root, false);

    expect(paragraph).not.toHaveAttribute('data-media-placeholder');
    expect(paragraph).not.toHaveAttribute('role');
  });
});

describe('replaceAttachmentImageUrls', () => {
  it('keeps attachment URLs off the source image until the media type is resolved', () => {
    const root = document.createElement('div');
    const id = '00000000-0000-4000-8000-000000000009';
    const image = document.createElement('img');
    image.src = `.complex-prompt/attachments/${id}.png`;
    root.append(image);

    replaceAttachmentImageUrls(
      root,
      'http://127.0.0.1:8765/_complex-prompt/attachments',
      'test-token',
      0,
    );

    expect(image.getAttribute('src')).toBe(INERT_MEDIA_IMAGE_SRC);
    expect(image.dataset['mediaSource']).toContain(`/${id}.png?token=test-token&refresh=0`);
    expect(image.dataset['mediaPending']).toBe('true');
    expect(
      getDrawingIdFromImage(
        image,
        'http://127.0.0.1:8765/_complex-prompt/attachments',
        'test-token',
      ),
    ).toBe(id);
  });
});
