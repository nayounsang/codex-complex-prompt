import type {
  FeedbackAnnotation,
  SelectionFeedbackAnnotation,
} from '@codex-complex-prompt/core/feedback';

export interface ModelRunResult {
  readonly output: string;
  readonly outputDirectory: string;
  readonly outputPath: string;
  readonly tracePath: string;
}

/** Product input and model output passed to every criterion for one evaluation run. */
export interface CriterionContext {
  /** Original Markdown loaded from the case fixture. */
  readonly original: string;
  /** Complete Markdown returned by the model. */
  readonly revised: string;
  /** Selection-specific details are absent when a case contains only global feedback. */
  readonly selections?: readonly SelectionFeedbackAnnotation[];
  /** Model output isolated for each selection; `null` when isolation fails. Uses `selections` order. */
  readonly selectedOutputs?: readonly (string | null)[];
  /** Whether all text outside the selected ranges is unchanged in the model output. */
  readonly selectionIsolationSucceeded?: boolean;
}

/** Result returned by one evaluation criterion. */
export interface CriterionResult {
  /** Whether the model response satisfies this criterion. */
  readonly passed: boolean;
  /** A short summary of the criterion's result or the reason it failed. */
  readonly detail: string;
}

export interface EvaluationCriterion<TOptions extends object> {
  readonly id: string;
  evaluate(
    context: CriterionContext,
    options: TOptions,
  ): CriterionResult | Promise<CriterionResult>;
}

export interface BoundCriterion {
  readonly id: string;
  evaluate(context: CriterionContext): CriterionResult | Promise<CriterionResult>;
}

export function configureCriterion<TOptions extends object>(
  criterion: EvaluationCriterion<TOptions>,
  options: TOptions,
): BoundCriterion {
  return {
    id: criterion.id,
    evaluate: (context) => criterion.evaluate(context, options),
  };
}

/** Evaluation metadata around the product feedback contract and response criteria. */
export interface ModelEvaluationCase {
  /** Unique identifier used to select the case. */
  readonly id: string;
  /** Human-readable title shown when listing registered cases. */
  readonly title: string;
  /** Markdown content from the editor. */
  readonly fixture: URL;
  /** Product annotations submitted with this case; global annotations are optional. */
  readonly annotations: readonly FeedbackAnnotation[];
  /** Criteria evaluated against the model's revised Markdown. */
  readonly criteria: readonly BoundCriterion[];
}
