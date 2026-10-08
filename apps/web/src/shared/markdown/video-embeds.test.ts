import { describe, expect, it } from 'vitest';

import { createVideoEmbedTargets, getVideoEmbedAffectedParagraphs } from './video-embeds.js';
import { MARKDOWN_UI_REPLACEMENT_MODEL } from './ui-replacements.js';

describe('createVideoEmbedTargets', () => {
  it('mounts a preview for a standalone direct video Markdown image', () => {
    const root = document.createElement('div');
    const mountRoot = document.createElement('div');
    const paragraph = document.createElement('p');
    paragraph.append(document.createTextNode('![](https://example.test/clip.mp4)'));
    root.append(paragraph);

    const targets = createVideoEmbedTargets(root, '![](https://example.test/clip.mp4)', mountRoot);

    expect(targets).toHaveLength(1);
    expect(targets[0]?.source).toBe('https://example.test/clip.mp4');
    expect(targets[0]?.mount.dataset['markdownUiReplacement']).toBe(
      MARKDOWN_UI_REPLACEMENT_MODEL.video.kind,
    );
    expect(paragraph.classList.contains('video-embed-target')).toBe(true);
  });

  it('does not replace an image with a non-standalone or unsafe video reference', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    paragraph.append(document.createTextNode('![](javascript:alert(1))'));
    root.append(paragraph);

    expect(createVideoEmbedTargets(root, 'text ![](javascript:alert(1))')).toEqual([]);
    expect(paragraph.classList.contains('video-embed-target')).toBe(false);
  });
});

describe('getVideoEmbedAffectedParagraphs', () => {
  it('maps a preview mount mutation back to its source paragraph', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    const mount = document.createElement('div');
    mount.className = MARKDOWN_UI_REPLACEMENT_MODEL.video.mountClassName;
    root.append(paragraph, mount);
    const observer = new MutationObserver(() => undefined);
    observer.observe(mount, { attributes: true });
    mount.setAttribute('data-ready', 'true');
    const records = observer.takeRecords();
    observer.disconnect();

    expect(getVideoEmbedAffectedParagraphs(root, records)).toEqual([paragraph]);
  });
});
