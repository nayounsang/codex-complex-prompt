import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { autoUpdate } from '@floating-ui/dom';

import type { MediaEmbedTarget } from '../../../shared/markdown/media-embeds.js';

interface MediaEmbedPortalProps {
  readonly target: MediaEmbedTarget;
  readonly pointerEvents: 'auto' | 'none';
  readonly children: ReactNode;
}

export function MediaEmbedPortal({
  target,
  pointerEvents,
  children,
}: MediaEmbedPortalProps): React.JSX.Element {
  const [position, setPosition] = useState<{
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  } | null>(null);
  const isImage = target.mimeType?.startsWith('image/') === true;

  useEffect(
    function positionMediaEmbed() {
      const updatePosition = (): void => {
        if (isImage) {
          const rect = target.image.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            setPosition({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
            return;
          }
        }
        const rect = target.container.getBoundingClientRect();
        if (rect.width <= 0) return;
        const width = Math.min(rect.width, 800);
        const hasVideoLayout = pointerEvents === 'auto' || target.path === '';
        const height = hasVideoLayout ? width * (9 / 16) : Math.max(rect.height, 36);
        setPosition({
          left: rect.left,
          top: hasVideoLayout ? rect.bottom - height : rect.top,
          width,
          height,
        });
      };
      return autoUpdate(target.image, target.mount, updatePosition);
    },
    [isImage, pointerEvents, target.path, target.container, target.image, target.mount],
  );

  return createPortal(
    position === null ? null : (
      <div
        className={`media-embed-frame${target.isHighlighted ? ' feedback-image-highlight' : ''}`}
        aria-hidden={isImage && target.path !== ''}
        style={{
          left: position.left,
          top: position.top,
          width: position.width,
          height: position.height,
          pointerEvents,
        }}
      >
        {children}
      </div>
    ),
    target.mount,
  );
}
