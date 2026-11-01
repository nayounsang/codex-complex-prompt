import { isSupportedVideoMimeType } from '@codex-complex-prompt/milkdown-plugins/media/core';
import { MediaRenderer } from '@codex-complex-prompt/milkdown-plugins/media/ui';
import type { MediaEmbedTarget } from '../../../shared/markdown/media-embeds.js';
import { MediaEmbedPortal } from './MediaEmbedPortal.js';

type MediaEmbedPreviewProps =
  | { readonly target: MediaEmbedTarget; readonly readOnly: true }
  | {
      readonly target: MediaEmbedTarget;
      readonly readOnly: false;
      readonly onChooseMedia: (image: HTMLImageElement) => void;
    };

export function MediaEmbedPreview(props: MediaEmbedPreviewProps): React.JSX.Element {
  const { target } = props;
  const isSupportedVideo = isSupportedVideoMimeType(target.mimeType);

  return (
    <MediaEmbedPortal
      target={target}
      pointerEvents={isSupportedVideo || (!props.readOnly && target.path === '') ? 'auto' : 'none'}
    >
      <MediaRenderer
        path={target.path}
        alt={target.alt}
        renderEmpty={() => (
          <button
            type="button"
            className="media-embed-status"
            disabled={props.readOnly}
            onClick={() => {
              if (props.readOnly) return;
              props.onChooseMedia(target.image);
            }}
          >
            Add media
          </button>
        )}
        renderError={() => (
          <div className="media-embed-status" role="img" aria-label="Media unavailable">
            Media unavailable
          </div>
        )}
      />
    </MediaEmbedPortal>
  );
}
