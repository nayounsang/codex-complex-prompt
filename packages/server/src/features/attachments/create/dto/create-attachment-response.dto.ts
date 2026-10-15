import { z } from 'zod';

export const CreateAttachmentResponseDtoSchema = z.object({ id: z.string() });
export type CreateAttachmentResponseDto = z.infer<typeof CreateAttachmentResponseDtoSchema>;
