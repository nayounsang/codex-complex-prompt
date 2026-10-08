import { z } from 'zod';

export const FeedbackLoopStateSchema = z
  .object({
    sessionId: z.string().optional(),
    cwd: z.string().optional(),
  })
  .passthrough();

export type FeedbackLoopState = z.infer<typeof FeedbackLoopStateSchema>;
