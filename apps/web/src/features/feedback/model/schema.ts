import { z } from 'zod';

export const SourceFeedbackRangeSchema = z.object({
  id: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export const SourceFeedbackRangesSchema = z.array(SourceFeedbackRangeSchema);
