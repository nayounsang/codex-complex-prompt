import { describe, expect, it } from 'vitest';

import { syncMediaPlaceholderAccessibility } from './markdown-editor-dom.js';

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
  paragraph.append(image);
  proseMirror.append(paragraph);
  root.append(proseMirror);
  return { root, paragraph };
}

describe('syncMediaPlaceholderAccessibility', () => {
  it('exposes a dedicated empty image as an accessible media button', () => {
    const { root, paragraph } = createPlaceholderRoot();

    syncMediaPlaceholderAccessibility(root, false);

    expect(paragraph).toMatchObject({ tabIndex: 0 });
    expect(paragraph).toHaveAttribute('role', 'button');
    expect(paragraph).toHaveAttribute('aria-label', 'Add media');
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
