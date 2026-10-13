import { z } from 'zod';

export const FeedbackModelSchema = z.object({
  model: z.string().min(1),
  reasoningEffort: z.string().min(1),
});

export type FeedbackModel = z.infer<typeof FeedbackModelSchema>;

export const FeedbackSubagentSettingsSchema = z.object({
  sendFeedbackToSubagent: z.boolean().optional(),
  feedbackModel: FeedbackModelSchema.optional(),
});

export type FeedbackSubagentSettings = z.infer<typeof FeedbackSubagentSettingsSchema>;
export type FeedbackSubagentContext = Omit<FeedbackSubagentSettings, 'sendFeedbackToSubagent'> & {
  readonly sendFeedbackToSubagent: boolean;
};

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
