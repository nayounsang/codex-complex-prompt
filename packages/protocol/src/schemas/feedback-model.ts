import { z } from 'zod';

export const FeedbackModelSchema = z.object({
  model: z.string().min(1),
  reasoningEffort: z.string().min(1),
});

export type FeedbackModel = z.infer<typeof FeedbackModelSchema>;

export const FeedbackModelCatalogEntrySchema = z.object({
  model: z.string().min(1),
  displayName: z.string().min(1),
  supportedReasoningEfforts: z.array(
    z.object({
      effort: z.string().min(1),
      description: z.string(),
    }),
  ),
  defaultReasoningEffort: z.string().min(1),
});

export const FeedbackModelCatalogSchema = z.array(FeedbackModelCatalogEntrySchema);

export type FeedbackModelCatalogEntry = z.infer<typeof FeedbackModelCatalogEntrySchema>;

export function isFeedbackModelSupported(
  feedbackModel: FeedbackModel,
  catalog: readonly FeedbackModelCatalogEntry[],
): boolean {
  return catalog.some(
    (entry) =>
      entry.model === feedbackModel.model &&
      entry.supportedReasoningEfforts.some(
        ({ effort }) => effort === feedbackModel.reasoningEffort,
      ),
  );
}
