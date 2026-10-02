# `@codex-complex-prompt/model-evaluation`

This internal package evaluates real Codex CLI responses without opening a browser or invoking a hook. It builds the same feedback annotations as the product, passes them to the serializer, and checks model responses against reusable criteria.

For usage instructions, see the [documentation](../../docs/manual-feedback-model-check.md).

## Requirements

- The Node.js and pnpm versions required by the repository.
- An authenticated Codex CLI (`codex`) available on `PATH`.
- Run the commands from the repository root.

## Commands

```sh
# List registered cases
pnpm --filter @codex-complex-prompt/model-evaluation run cases

# Run criterion unit tests
pnpm --filter @codex-complex-prompt/model-evaluation test

# Run a case against the local model
pnpm --filter @codex-complex-prompt/model-evaluation eval selection-feedback-scope

# Run type checking and lint
pnpm --filter @codex-complex-prompt/model-evaluation typecheck
pnpm --filter @codex-complex-prompt/model-evaluation lint
```

Codex runs in a read-only sandbox. The runner prints each criterion's result and the paths to the original fixture, revised Markdown, and Codex JSONL trace.

## Writing test cases

1. Add an `.md` file under `packages/model-evaluation/fixtures` to use as the editor content.
2. Create a test case that conforms to [`ModelEvaluationCase`](./src/types.ts).
3. Register the case in [`evaluationCases`](./src/cases/index.ts).

## Interpreting results

Passing means that the response satisfied the conditions configured for that case; it does not guarantee consistent behavior on later calls. Repeat the run with the same settings and inspect the output and trace when evaluating reliability.
