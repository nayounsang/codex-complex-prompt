import { useState } from 'react';

import { isSupportedVideoMimeType } from './core.js';

export interface MediaRendererProps {
  readonly path: string;
  readonly mimeType: string | null;
  readonly alt?: string;
  readonly renderEmpty: () => React.ReactNode;
  readonly renderError: (error: unknown) => React.ReactNode;
}

export function MediaRenderer({
  path,
  mimeType,
  alt,
  renderEmpty,
  renderError,
}: MediaRendererProps): React.JSX.Element | React.ReactNode {
  const [loadError, setLoadError] = useState<{ readonly path: string; readonly error: unknown }>();

  if (path === '') return renderEmpty();
  if (loadError?.path === path) return renderError(loadError.error);

  if (mimeType?.startsWith('image/') === true) {
    return (
      <img
        src={path}
        alt={alt ?? ''}
        onError={(event) => setLoadError({ path, error: event.nativeEvent })}
      />
    );
  }
  if (isSupportedVideoMimeType(mimeType)) {
    return (
      <video
        src={path}
        aria-label={alt || undefined}
        controls
        playsInline
        preload="metadata"
        onError={(event) => setLoadError({ path, error: event.nativeEvent })}
      />
    );
  }
  return renderError(new Error(`Unsupported media MIME type: ${mimeType ?? 'unknown'}`));
}
