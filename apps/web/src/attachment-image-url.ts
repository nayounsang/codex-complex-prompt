export function createAttachmentImageUrl(
  baseUrl: string,
  id: string,
  token: string,
  refreshKey: number,
  extension = 'png',
): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/${id}.${extension}`);
  url.searchParams.set('token', token);
  url.searchParams.set('refresh', String(refreshKey));
  return url.toString();
}
