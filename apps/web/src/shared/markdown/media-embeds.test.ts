import { describe, expect, it } from 'vitest';

import {
  createMediaEmbedTargets,
  getMediaEmbedAffectedContainers,
  haveSameMediaEmbedTargets,
} from './media-embeds.js';

describe('createMediaEmbedTargets', () => {
  it('passes image paths and alt text to targets, including authenticated attachment URLs', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="ProseMirror"><p><img src="./cover.PNG?size=2" alt="Cover"></p><p><img src="data:image/gif;base64,AA==" alt=""></p></div>';
    const mountRoot = document.createElement('div');
    const images = root.querySelectorAll('img');
    const attachment = images[1];
    if (!(attachment instanceof HTMLImageElement)) throw new Error('Missing attachment image');
    attachment.dataset['videoSource'] = 'https://attachments.test/clip.MP4?token=secret';

    const targets = createMediaEmbedTargets(root, mountRoot);

    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      path: './cover.PNG?size=2',
      alt: 'Cover',
      mimeType: 'image/png',
    });
    expect(targets[1]).toMatchObject({
      path: 'https://attachments.test/clip.MP4?token=secret',
      alt: '',
      mimeType: 'video/mp4',
    });
    expect(mountRoot.querySelectorAll('.media-embed-mount')).toHaveLength(2);
    expect(images[0]).not.toHaveAttribute('data-media-embed-id');
    expect(images[0]).not.toHaveAttribute('aria-hidden');
    expect(root.querySelector('.media-embed-mount')).toBeNull();
  });

  it('passes empty and unsupported paths through for consumer error rendering', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="ProseMirror"><p><img src="" alt=""></p><p><img src="clip.avi" alt="Clip"></p></div>';

    expect(createMediaEmbedTargets(root).map(({ path, mimeType }) => [path, mimeType])).toEqual([
      ['', null],
      ['clip.avi', 'video/x-msvideo'],
    ]);
  });

  it('leaves upload placeholders to the host picker', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="ProseMirror"><p data-media-placeholder="true"><img src="" alt="media-placeholder-1"></p></div>';

    expect(createMediaEmbedTargets(root)).toEqual([]);
  });

  it('recognizes the persisted host marker even when read-only mode removed its button UI', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="ProseMirror"><p><img src="" alt="media-placeholder-123"></p></div>';

    expect(createMediaEmbedTargets(root)).toEqual([]);
  });

  it('skips ProseMirror separators and images inside preview mounts', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="ProseMirror"><p><img class="ProseMirror-separator" src="" alt=""></p><div class="media-embed-mount"><img src="preview.png" alt="Preview"></div></div>';

    expect(createMediaEmbedTargets(root)).toEqual([]);
  });
});

describe('getMediaEmbedAffectedContainers', () => {
  it('maps image mutations to the containing paragraph', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    const image = document.createElement('img');
    paragraph.append(image);
    root.append(paragraph);
    const observer = new MutationObserver(() => undefined);
    observer.observe(image, { attributes: true });
    image.setAttribute('alt', 'Cover');
    const records = observer.takeRecords();
    observer.disconnect();

    expect(getMediaEmbedAffectedContainers(root, records)).toEqual([paragraph]);
  });

  it('ignores mutations inside the screen-only media mount', () => {
    const root = document.createElement('div');
    const mount = document.createElement('div');
    mount.className = 'media-embed-mount';
    root.append(mount);
    const image = document.createElement('img');
    const observer = new MutationObserver(() => undefined);
    observer.observe(root, { childList: true, subtree: true });
    mount.append(image);
    const records = observer.takeRecords();
    observer.disconnect();

    expect(getMediaEmbedAffectedContainers(root, records)).toEqual([]);
  });
});

describe('haveSameMediaEmbedTargets', () => {
  it('compares every target property while allowing equivalent target objects', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="ProseMirror"><p><img src="cover.png" alt="Cover"></p></div>';
    const targets = createMediaEmbedTargets(root);
    const equivalentTargets = targets.map((target) => ({ ...target }));
    const changedMimeTargets = targets.map((target) => ({ ...target, mimeType: 'image/jpeg' }));

    expect(haveSameMediaEmbedTargets(targets, equivalentTargets)).toBe(true);
    expect(haveSameMediaEmbedTargets(targets, changedMimeTargets)).toBe(false);
  });
});
