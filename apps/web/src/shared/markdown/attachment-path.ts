export const MARKDOWN_ATTACHMENT_DIRECTORY = '.complex-prompt/attachments';

const attachmentIdPattern = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const escapedAttachmentDirectory = MARKDOWN_ATTACHMENT_DIRECTORY.replace(
  /[.*+?^${}()|[\]\\]/g,
  '\\$&',
);

export function getMarkdownAttachmentId(source: string, allowQuery = false): string | null {
  const queryPattern = allowQuery ? '(?:\\?.*)?' : '';
  const match = source.match(
    new RegExp(
      `^(?:\\./)?${escapedAttachmentDirectory}/(${attachmentIdPattern})\\.png${queryPattern}$`,
      'i',
    ),
  );
  return match?.[1]?.toLowerCase() ?? null;
}

export function getConfiguredAttachmentId(
  source: string,
  attachmentUrl: string | null | undefined,
  baseUri: string = document.baseURI,
): string | null {
  if (attachmentUrl == null) return null;
  try {
    const imageUrl = new URL(source, baseUri);
    const baseUrl = new URL(attachmentUrl);
    if (imageUrl.origin !== baseUrl.origin) return null;
    const basePath = baseUrl.pathname.replace(/\/+$/, '');
    const attachmentPath = imageUrl.pathname.startsWith(`${basePath}/`)
      ? imageUrl.pathname.slice(basePath.length)
      : '';
    return (
      attachmentPath
        .match(new RegExp(`^/(${attachmentIdPattern})\\.png$`, 'i'))?.[1]
        ?.toLowerCase() ?? null
    );
  } catch {
    return null;
  }
}

export function createMarkdownAttachmentImagePattern(): RegExp {
  return new RegExp(
    `!\\[([^\\]]*)\\]\\(${escapedAttachmentDirectory}/(${attachmentIdPattern})\\.png\\)`,
    'gi',
  );
}
