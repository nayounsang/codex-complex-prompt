import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MediaRenderer } from '@codex-complex-prompt/milkdown-plugins/media/ui';

describe('MediaRenderer', () => {
  it('renders images with the received path and alt text', () => {
    render(<MediaRenderer path="./cover.PNG?size=2#preview" alt="Cover" />);

    expect(screen.getByAltText('Cover')).toHaveAttribute('src', './cover.PNG?size=2#preview');
  });

  it.each(['video/mp4', 'video/quicktime', 'video/webm'])(
    'renders %s as a controlled video',
    (mime) => {
      const extension = mime === 'video/quicktime' ? 'mov' : mime.slice('video/'.length);
      const { container } = render(
        <MediaRenderer
          path={`https://example.test/clip.${extension}?token=secret`}
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

  it('passes the original load error value to the consumer', () => {
    const renderError = vi.fn(() => <div role="alert">Failed</div>);
    const { container } = render(
      <MediaRenderer path="cover.png" renderEmpty={() => null} renderError={renderError} />,
    );
    const image = container.querySelector('img');
    if (image === null) throw new Error('Missing rendered image');
    const errorEvent = new Event('error');

    fireEvent(image, errorEvent);

    expect(renderError).toHaveBeenCalledWith(errorEvent);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('uses the empty callback for an empty destination and reports unsupported MIME types', () => {
    const renderEmpty = vi.fn(() => <div>Empty</div>);
    const empty = render(<MediaRenderer path="" renderEmpty={renderEmpty} />);
    expect(renderEmpty).toHaveBeenCalledOnce();
    empty.unmount();

    const renderError = vi.fn(() => <div>Unsupported</div>);
    render(<MediaRenderer path="clip.avi" renderError={renderError} />);
    expect(renderError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Unsupported media MIME type: video/x-msvideo' }),
    );
  });

  it('throws when a required state callback is omitted', () => {
    expect(() => render(<MediaRenderer path="" />)).toThrow();
    expect(() => render(<MediaRenderer path="document.pdf" />)).toThrow();
  });
});
