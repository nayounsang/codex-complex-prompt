import mime from 'mime';

const supportedVideoMimeTypes = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

export function getMediaMimeType(path: string): string | null {
  try {
    return mime.getType(new URL(path, 'https://media.invalid').pathname);
  } catch {
    return null;
  }
}

export function isSupportedVideoMimeType(mimeType: string | null): boolean {
  return mimeType !== null && supportedVideoMimeTypes.has(mimeType);
}
