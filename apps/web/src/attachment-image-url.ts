export function createAttachmentImageUrl(
  baseUrl: string,
  id: string,
  token: string,
  refreshKey: number,
): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/${id}.png`);
  url.searchParams.set('token', token);
  url.searchParams.set('refresh', String(refreshKey));
  return url.toString();
}
