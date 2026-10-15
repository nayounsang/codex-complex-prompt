import { z } from 'zod';

export const SessionCredentialsDtoSchema = z.object({
  id: z.string().uuid(),
  token: z.string().min(32),
  expiresAt: z.date(),
});
export type SessionCredentialsDto = z.infer<typeof SessionCredentialsDtoSchema>;
