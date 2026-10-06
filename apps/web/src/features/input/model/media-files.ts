const videoTypesByExtension: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

export function isSupportedMediaFile(file: File): boolean {
  if (file.type.startsWith('image/') || file.type === '') return true;
  const videoMimeType = getVideoMimeType(file);
  return (
    videoMimeType !== null &&
    (file.type === videoMimeType || file.type === 'application/octet-stream')
  );
}

export function getVideoMimeType(file: File): string | null {
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  return extension === undefined ? null : (videoTypesByExtension[extension] ?? null);
}

export function getVideoExtension(file: File): string | null {
  const videoMimeType = getVideoMimeType(file);
  if (videoMimeType === null) return null;
  if (file.type !== '' && file.type !== 'application/octet-stream' && file.type !== videoMimeType) {
    return null;
  }
  return videoMimeType === 'video/quicktime'
    ? 'mov'
    : videoMimeType === 'video/webm'
      ? 'webm'
      : 'mp4';
}
