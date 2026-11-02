import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MediaRenderer } from '@codex-complex-prompt/milkdown-plugins/media/ui';

describe('MediaRenderer', () => {
  it('renders images with the received path and alt text', () => {
    render(
      <MediaRenderer
        path="./cover.PNG?size=2#preview"
        mimeType="image/png"
        alt="Cover"
        renderEmpty={() => null}
        renderError={() => null}
      />,
    );

    expect(screen.getByAltText('Cover')).toHaveAttribute('src', './cover.PNG?size=2#preview');
  });

  it.each(['video/mp4', 'video/quicktime', 'video/webm'])(
    'renders %s as a controlled video',
    (mime) => {
      const extension = mime === 'video/quicktime' ? 'mov' : mime.slice('video/'.length);
      const { container } = render(
        <MediaRenderer
          path={`https://example.test/clip.${extension}?token=secret`}
          mimeType={mime}
          renderEmpty={() => null}
          renderError={() => null}
        />,
      );

      const video = container.querySelector('video');
      expect(video).not.toBeNull();
      expect(video).toHaveAttribute('src', `https://example.test/clip.${extension}?token=secret`);
      expect(video).toHaveAttribute('controls');
    },
  );

  it('uses the Markdown alt text as the video accessible name', () => {
    render(
      <MediaRenderer
        path="clip.mp4"
        mimeType="video/mp4"
        alt="A short clip"
        renderEmpty={() => null}
        renderError={() => null}
      />,
    );

    expect(screen.getByLabelText('A short clip').tagName).toBe('VIDEO');
  });

  it('passes the original load error value to the consumer', () => {
    const renderError = vi.fn(() => <div role="alert">Failed</div>);
    const { container } = render(
      <MediaRenderer
        path="cover.png"
        mimeType="image/png"
        renderEmpty={() => null}
        renderError={renderError}
      />,
    );
    const image = container.querySelector('img');
    if (image === null) throw new Error('Missing rendered image');
    const errorEvent = new Event('error');

    fireEvent(image, errorEvent);

    expect(renderError).toHaveBeenCalledWith(errorEvent);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('uses the empty callback for an empty destination', () => {
    const renderEmpty = vi.fn(() => <div>Empty</div>);
    render(
      <MediaRenderer path="" mimeType={null} renderEmpty={renderEmpty} renderError={() => null} />,
    );
    expect(renderEmpty).toHaveBeenCalledOnce();
  });

  it('reports unsupported MIME types to the error callback', () => {
    const renderError = vi.fn(() => <div>Unsupported</div>);
    render(
      <MediaRenderer
        path="clip.avi"
        mimeType="video/x-msvideo"
        renderEmpty={() => null}
        renderError={renderError}
      />,
    );
    expect(renderError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Unsupported media MIME type: video/x-msvideo' }),
    );
  });
});
