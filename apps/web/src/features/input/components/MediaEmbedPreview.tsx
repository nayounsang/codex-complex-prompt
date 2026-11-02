import { useEffect, useState } from 'react';

import {
  isSupportedVideoMimeType,
  resolveMediaMimeType,
} from '@codex-complex-prompt/milkdown-plugins/media/core';
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

type MediaMimeResolution =
  | { readonly path: string; readonly mimeType: string }
  | { readonly path: string; readonly error: unknown };

export function MediaEmbedPreview(props: MediaEmbedPreviewProps): React.JSX.Element | null {
  const { target } = props;
  const [resolution, setResolution] = useState<MediaMimeResolution | null>(null);

  useEffect(
    function resolveMediaType() {
      if (target.path === '' || target.mimeType !== null) return;
      let active = true;
      const controller = new AbortController();
      void resolveMediaMimeType(target.path, controller.signal).then(
        (mimeType) => {
          if (active) setResolution({ path: target.path, mimeType });
        },
        (error: unknown) => {
          if (active) setResolution({ path: target.path, error });
        },
      );
      return () => {
        active = false;
        controller.abort();
      };
    },
    [target.mimeType, target.path],
  );

  const currentResolution =
    target.path === ''
      ? null
      : target.mimeType !== null
        ? { path: target.path, mimeType: target.mimeType }
        : resolution?.path === target.path
          ? resolution
          : null;
  if (target.path !== '' && currentResolution === null) return null;

  const mimeType =
    currentResolution !== null && 'mimeType' in currentResolution
      ? currentResolution.mimeType
      : null;
  const resolvedTarget = { ...target, mimeType };
  const isSupportedVideo = isSupportedVideoMimeType(mimeType);
  const renderError = (): React.JSX.Element => (
    <div className="media-embed-status" role="img" aria-label="Media unavailable">
      Media unavailable
    </div>
  );

  return (
    <MediaEmbedPortal
      target={resolvedTarget}
      pointerEvents={isSupportedVideo || (!props.readOnly && target.path === '') ? 'auto' : 'none'}
    >
      {currentResolution !== null && 'error' in currentResolution ? (
        renderError()
      ) : (
        <MediaRenderer
          path={target.path}
          mimeType={mimeType}
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
          renderError={renderError}
        />
      )}
    </MediaEmbedPortal>
  );
}
