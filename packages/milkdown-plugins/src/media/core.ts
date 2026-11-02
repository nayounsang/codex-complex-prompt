const supportedVideoMimeTypes = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

export function getMediaMimeType(path: string): string | null {
  return /^data:([^;,]+)/i.exec(path)?.[1]?.toLowerCase() ?? null;
}

export async function resolveMediaMimeType(path: string, signal?: AbortSignal): Promise<string> {
  const dataMimeType = getMediaMimeType(path);
  if (dataMimeType !== null) return dataMimeType;

  const response = await fetch(path, {
    method: 'HEAD',
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`Unable to determine media MIME type: HTTP ${response.status}`);

  const mimeType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mimeType === undefined || mimeType === '')
    throw new Error('Media response did not provide a Content-Type header');
  return mimeType;
}

export function isSupportedVideoMimeType(mimeType: string | null): boolean {
  return mimeType !== null && supportedVideoMimeTypes.has(mimeType);
}
