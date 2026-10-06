import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { autoUpdate } from '@floating-ui/dom';

import type { VideoEmbedTarget } from '../../../shared/markdown/video-embeds.js';

export function VideoEmbedPreview({
  target,
}: {
  readonly target: VideoEmbedTarget;
}): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState<{
    readonly left: number;
    readonly top: number;
    readonly width: number;
  } | null>(null);
  useEffect(
    function positionVideoPreview() {
      const updatePosition = (): void => {
        const paragraphRect = target.paragraph.getBoundingClientRect();
        const placeholderHeight = Number.parseFloat(
          window.getComputedStyle(target.paragraph, '::after').height,
        );
        if (!Number.isFinite(placeholderHeight) || paragraphRect.width <= 0) return;
        setPosition({
          left: paragraphRect.left,
          top: paragraphRect.bottom - placeholderHeight,
          width: Math.min(paragraphRect.width, 800),
        });
      };
      return autoUpdate(target.paragraph, target.mount, updatePosition);
    },
    [target.mount, target.paragraph],
  );
  return createPortal(
    position === null ? null : failed ? (
      <div
        className="video-embed-frame video-embed-fallback"
        style={{ left: position.left, top: position.top, width: position.width }}
        role="img"
        aria-label="Video unavailable"
      >
        <img src="/video-unavailable.svg" alt="" />
      </div>
    ) : (
      <div
        className="video-embed-frame"
        style={{ left: position.left, top: position.top, width: position.width }}
      >
        <video
          className="video-embed-player"
          src={target.source}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        />
      </div>
    ),
    target.mount,
  );
}
