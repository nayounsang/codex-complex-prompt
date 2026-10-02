# Adding Model Evaluation Cases

`@codex-complex-prompt/model-evaluation` uses the product's feedback payload and sends it directly to the local Codex CLI to evaluate the response. It does not need to capture selections through the browser UI or install the product hook.

## Evaluation components

Each evaluation combines the following in a `ModelEvaluationCase`:

- **Fixture:** the original text representing the editor document
- **Feedback:** global feedback and one or more selection-specific instructions
- **Criteria:** machine-checkable conditions that the response must satisfy

The model runner is separate from the evaluation logic, so the runner or model adapter can be changed without changing fixtures and criteria.

## Adding an evaluation case

### 1. Choose the document and behavior to evaluate

1. Add a document under `packages/model-evaluation/fixtures/` that represents actual editor content.

2. Specify the behavior to check in the model response.
   - “Follow the request well” is not a checkable criterion.
   - State an expected result that can be compared with the input, such as “Remove `Retry-After: 30` from the selected rule and keep the HTTP 429 response.”
   - Also specify what must remain unchanged outside the selection.

### 2. Define the feedback selection range

Define each selection with a zero-based `[start, end)` range in the original document.

- `quote` must exactly match `fixture.slice(start, end)`.
- Selection ranges must not overlap or touch. Leave at least one unchanged character between selections so the runner can isolate each result; if the response makes a separator ambiguous, the evaluation fails safely.
- Express global feedback as a `scope: 'global'` annotation and omit it when the case has none.

If the source document changes, update the offsets and quote together. If range validation fails, the runner does not call the model.

### 3. Write and register the evaluation case

Declare a `ModelEvaluationCase` in `packages/model-evaluation/src/cases/`.

```ts
import type { FeedbackAnnotation } from '@codex-complex-prompt/core';
import { selectedFeedbackApplied } from '../criteria/selected-feedback-applied.js';
import { outsideSelectionUnchanged } from '../criteria/outside-selection-unchanged.js';
import { configureCriterion, type ModelEvaluationCase } from '../types.js';

const exampleCase: ModelEvaluationCase = {
  id: 'example-feedback-scope',
  title: 'Selected feedback stays within its range',
  fixture: new URL('../../fixtures/example.md', import.meta.url),
  annotations: [
    {
      id: 'example-selection-1',
      scope: 'selection',
      start: 100,
      end: 180,
      quote: 'The exact source text selected in the fixture',
      feedback: 'Apply a specific edit to this selection.',
    },
  ] satisfies readonly FeedbackAnnotation[],
  criteria: [
    configureCriterion(selectedFeedbackApplied, {
      selectionIndex: 0,
      mustNotContain: 'text to remove',
      mustContain: 'text to retain',
    }),
    configureCriterion(outsideSelectionUnchanged, {}),
  ],
};
```

After creating the case, register it in the `evaluationCases` array in `packages/model-evaluation/src/cases/index.ts`.

### 4. Choose criteria for the case

```ts
export interface BoundCriterion {
  readonly id: string;
  evaluate(context: CriterionContext): CriterionResult | Promise<CriterionResult>;
}
```

See the [type declarations](../packages/model-evaluation/src/types.ts) for details.

The available criteria are:

- `selectedFeedbackApplied`: checks whether requested text was removed or retained in a specific selection
- `outsideSelectionUnchanged`: checks whether all source text outside the selections remains unchanged
- `similarContentPreserved`: checks whether specified similar passages remain in the response

Configure and combine criteria in a case with `configureCriterion(criterion, options)`. Reuse an existing criterion when it can express the condition a new case needs. Pass case-specific strings and selection indexes through criterion options. Put reusable evaluation logic in criteria modules and keep case files focused on configuration.

### 5. Add a reusable criterion

When the available criteria cannot express a required check, add a criterion module under `packages/model-evaluation/src/criteria/`.

```ts
import type { EvaluationCriterion } from '../types.js';

interface RequiredPhraseOptions {
  readonly phrase: string;
}

const requiredPhrase: EvaluationCriterion<RequiredPhraseOptions> = {
  id: 'required-phrase',
  evaluate({ revised }, { phrase }) {
    const passed = revised.includes(phrase);
    return {
      passed,
      detail: passed ? 'Required phrase is present.' : 'Required phrase is missing.',
    };
  },
};
```

Criteria should evaluate only the context and options they receive; they should not read the fixture or call a model directly.

## Running an evaluation

From the repository root, run the criterion unit tests first. To run a model evaluation, use an environment with an authenticated `codex` CLI on `PATH`.

```sh
pnpm --filter @codex-complex-prompt/model-evaluation test
pnpm --filter @codex-complex-prompt/model-evaluation eval example-feedback-scope
```

Model output is saved to a new temporary directory and does not overwrite workspace files.

The local model evaluation checks the real feedback payload together with the model response. Since responses can vary between calls, run the same case several times and review how consistent the results are.

## Adding a new evaluation topic

- Keep shared input and output contracts in `ModelEvaluationCase` and `CriterionContext`, and separate the evaluation logic into criteria.
- Make behavior shared by multiple cases reusable criteria; keep scenario-specific documents and feedback in each case.
- Keep model execution settings and provider differences in an adapter separate from evaluation criteria.

These boundaries let you add evaluation topics without changing the input contract or execution path of existing cases.
