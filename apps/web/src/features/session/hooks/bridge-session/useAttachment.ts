import { useCallback, useState } from 'react';

export function useAttachment() {
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [attachmentToken, setAttachmentToken] = useState<string | null>(null);

  const setAttachment = useCallback((url: string | null, token: string | null) => {
    setAttachmentUrl(url);
    setAttachmentToken(token);
  }, []);

  return {
    attachmentUrl,
    attachmentToken,
    setAttachment,
  };
}
