import { useState } from 'react';

import { getMediaMimeType, isSupportedVideoMimeType } from './core.js';

export interface MediaRendererProps {
  readonly path: string;
  readonly alt?: string;
  readonly renderEmpty?: () => React.ReactNode;
  readonly renderError?: (error: unknown) => React.ReactNode;
}

export function MediaRenderer({
  path,
  alt,
  renderEmpty,
  renderError,
}: MediaRendererProps): React.JSX.Element | React.ReactNode {
  const [loadError, setLoadError] = useState<{ readonly path: string; readonly error: unknown }>();

  if (path === '') return renderEmpty!();
  if (loadError?.path === path) return renderError!(loadError.error);

  const mimeType = getMediaMimeType(path);
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
        controls
        playsInline
        preload="metadata"
        onError={(event) => setLoadError({ path, error: event.nativeEvent })}
      />
    );
  }
  return renderError!(new Error(`Unsupported media MIME type: ${mimeType ?? 'unknown'}`));
}
