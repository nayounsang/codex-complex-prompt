import type { SelectionFeedbackAnnotation } from '@codex-complex-prompt/core/feedback';

export interface SelectionIsolationResult {
  readonly selectedOutputs: readonly (string | null)[];
  readonly succeeded: boolean;
}

export function isolateSelections(
  original: string,
  revised: string,
  selections: readonly Pick<SelectionFeedbackAnnotation, 'start' | 'end' | 'quote'>[],
): SelectionIsolationResult {
  if (selections.length === 0) return { selectedOutputs: [], succeeded: true };

  const orderedSelections = selections
    .map((selection, originalIndex) => ({ selection, originalIndex }))
    .sort((left, right) => left.selection.start - right.selection.start);
  const outputs: (string | null)[] = selections.map(() => null);
  const firstSelection = orderedSelections[0];
  if (firstSelection === undefined) return failedIsolation(selections);
  let revisedCursor = 0;
  const unchangedPrefix = original.slice(0, firstSelection.selection.start);
  if (!revised.startsWith(unchangedPrefix)) return failedIsolation(selections);
  revisedCursor = unchangedPrefix.length;
  const lastSelection = orderedSelections[orderedSelections.length - 1];
  if (lastSelection === undefined) return failedIsolation(selections);
  const unchangedSuffix = original.slice(lastSelection.selection.end);
  const suffixStart = revised.length - unchangedSuffix.length;
  if (suffixStart < revisedCursor || !revised.endsWith(unchangedSuffix)) {
    return failedIsolation(selections);
  }

  for (const [index, { selection, originalIndex }] of orderedSelections.entries()) {
    const nextSelection = orderedSelections[index + 1]?.selection;
    if (nextSelection === undefined) {
      outputs[originalIndex] = revised.slice(revisedCursor, suffixStart);
      break;
    }

    const unchangedBetweenSelections = original.slice(selection.end, nextSelection.start);
    if (unchangedBetweenSelections === '') return failedIsolation(selections);
    const revisedGapStart = revised.indexOf(unchangedBetweenSelections, revisedCursor);
    const revisedGapEnd = revisedGapStart + unchangedBetweenSelections.length;
    const nextGapStart = revised.indexOf(unchangedBetweenSelections, revisedGapStart + 1);
    if (
      revisedGapStart < revisedCursor ||
      revisedGapEnd > suffixStart ||
      (nextGapStart !== -1 && nextGapStart + unchangedBetweenSelections.length <= suffixStart)
    ) {
      return failedIsolation(selections);
    }

    outputs[originalIndex] = revised.slice(revisedCursor, revisedGapStart);
    revisedCursor = revisedGapEnd;
  }

  return { selectedOutputs: outputs, succeeded: true };
}

function failedIsolation(
  selections: readonly Pick<SelectionFeedbackAnnotation, 'start' | 'end' | 'quote'>[],
): SelectionIsolationResult {
  return { selectedOutputs: selections.map(() => null), succeeded: false };
}
