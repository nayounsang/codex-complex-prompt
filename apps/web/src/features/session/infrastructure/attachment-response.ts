import { AttachmentResponseSchema, type AttachmentResponse } from './schema.js';

export function parseAttachmentResponse(
  responseText: string,
  status: number,
  fallbackMessage: string,
): AttachmentResponse {
  let value: unknown;
  try {
    value = JSON.parse(responseText);
  } catch {
    throw new Error(responseText.trim() || fallbackMessage);
  }
  const result = AttachmentResponseSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`The attachment server returned an invalid response (HTTP ${status}).`);
  }
  return result.data;
}
