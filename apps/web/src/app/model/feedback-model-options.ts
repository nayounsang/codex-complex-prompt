import type { FeedbackModel, FeedbackModelCatalogEntry } from '@codex-complex-prompt/protocol';

export interface FeedbackModelOption {
  readonly value: string;
  readonly label: string;
  readonly model?: FeedbackModel['model'];
  readonly reasoningEffort?: FeedbackModel['reasoningEffort'];
}

export function createFeedbackModelOptions(
  catalog: readonly FeedbackModelCatalogEntry[],
): readonly FeedbackModelOption[] {
  return [
    { value: 'current', label: 'Current Codex model (default)' },
    ...catalog.flatMap(({ model, displayName, supportedReasoningEfforts }) =>
      supportedReasoningEfforts.map(({ effort }) => ({
        value: `${model}:${effort}`,
        label: `${displayName} (${model}): ${effort}`,
        model,
        reasoningEffort: effort,
      })),
    ),
  ];
}

export function getFeedbackModelOption(
  value: string | null,
  options: readonly FeedbackModelOption[],
): FeedbackModelOption {
  return options.find((option) => option.value === value) ?? options[0]!;
}

export function getFeedbackModel(option: FeedbackModelOption): FeedbackModel | undefined {
  return option.model === undefined || option.reasoningEffort === undefined
    ? undefined
    : { model: option.model, reasoningEffort: option.reasoningEffort };
}
