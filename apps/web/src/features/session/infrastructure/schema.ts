import { z } from 'zod';

export const AttachmentResponseSchema = z
  .object({
    id: z.string().optional(),
    extension: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

export type AttachmentResponse = z.infer<typeof AttachmentResponseSchema>;
