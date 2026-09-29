# @codex-complex-prompt/cli-bridge

A **Codex CLI-only** browser-based document editor. Draft and review complex tasks, research requests, and writing prompts in a Notion-like editor, incorporate Codex feedback, then submit the version you reviewed. This package is not supported in the Codex app.

## Install

```bash
npx @codex-complex-prompt/cli-bridge hook install
```

Restart Codex CLI. If it asks you to review the newly registered hook, open `/hooks` and approve it. The installer keeps your existing hooks and registers this one alongside them.

## Use

Invoke the skill from Codex CLI to open the editor.

```text
$complex-prompt Organize this complex request
```

Plain text becomes the editor draft. A `.md` or `.txt` file path loads that file. Edit the draft in the browser, select **Send Feedback** to incorporate Codex feedback, then select **Submit** to run the reviewed request.

## Manage the installation

```bash
# Preview the changes before applying them.
npx @codex-complex-prompt/cli-bridge hook install --dry-run

# Remove the items installed by this package. Other hooks and settings are preserved.
npx @codex-complex-prompt/cli-bridge hook remove
```

See the [project README](https://github.com/nayounsang/codex-complex-prompt#readme) for usage details and the [development guide](https://github.com/nayounsang/codex-complex-prompt/blob/main/docs/development.md) for contributor instructions.
