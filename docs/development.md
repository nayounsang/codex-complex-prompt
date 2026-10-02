# Development and contribution

## Repository layout

- `apps/cli-bridge`: npm CLI, Codex CLI hooks, local bridge server, and setup commands
- `apps/web`: Markdown editor and AI feedback review UI
- `packages/protocol`: messages between the CLI and browser, plus Codex hook input schemas
- `packages/server`: loopback HTTP/WebSocket server and session policies
- `packages/core`: transport-independent draft, submission history, and execution state
- `e2e`: end-to-end flows between the CLI hook and browser

## Local development

### Initial setup

Install dependencies and build the CLI and web UI from the repository root. Register the hook and skill in your local Codex settings once, then restart Codex CLI to load the settings.

```bash
pnpm install
pnpm build
CLI_BRIDGE="$(pwd)/apps/cli-bridge/dist/index.js"

# Preview what will be added to the settings file without changing it.
node "$CLI_BRIDGE" hook install --dry-run

# Install the hook and skill in your local Codex settings. This is only needed once.
node "$CLI_BRIDGE" hook install
```

When Codex CLI asks you to review the hook the first time it runs, open `/hooks` and approve it.

### After changing code

The CLI browser tests run the web bundle copied into the CLI package at `apps/web/dist`. Building only the CLI package may leave the bundled UI out of date, so rebuild the workspace after changing code:

```bash
pnpm build
```

Invoke the skill from Codex CLI to check the real user flow:

```text
$complex-prompt ## test test test
```

### (Optional) Model Evaluate

For direct model checks that evaluate feedback behavior against reusable criteria, follow [the AI feedback scope check](manual-feedback-model-check.md).

### Reproduce hook input directly

You can reproduce the `UserPromptSubmit` input sent by Codex instead of invoking the skill. This command opens the browser editor and waits for you to submit from the editor.

```bash
CLI_BRIDGE="$(pwd)/apps/cli-bridge/dist/index.js"

# Reproduce a Codex UserPromptSubmit event and open the browser editor.
printf '%s\n' '{"hook_event_name":"UserPromptSubmit","prompt":"$complex-prompt local command"}' | node "$CLI_BRIDGE" hook prompt
```

### Remove the local hook

When you no longer need the development hook and skill, remove them from the same repository root where you installed them.

```bash
CLI_BRIDGE="$(pwd)/apps/cli-bridge/dist/index.js"

# Remove the items installed by this package.
node "$CLI_BRIDGE" hook remove
```

## Quality checks

The Git commit hook formats staged files. Before `git push`, the pre-push hook checks formatting, lint, types, and tests. A failed check stops the push.

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

End-to-end tests use the built web UI and a mock Codex process; they do not call a real model. Install Chromium before running them.

```bash
pnpm --filter @codex-complex-prompt/e2e exec playwright install chromium
pnpm test:e2e
```

## Releases

1. Add a changeset with `pnpm changeset` for changes that affect published packages.
2. After the pull request is merged, a version pull request is created to update the changelog.
3. Merge the version pull request to publish the release.

This project follows [Semantic Versioning](https://semver.org/).
