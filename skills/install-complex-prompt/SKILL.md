---
name: install-complex-prompt
description: Install, update, or remove the Codex Complex Prompt CLI hooks and skill when the user asks to configure it.
---

# Install Codex Complex Prompt

Use this skill to explain how to install, update, or remove Codex Complex Prompt. Do not run installation or removal commands; show the user the relevant command so they can execute it in their terminal. The editor and `$complex-prompt` skill are provided by the upstream npm CLI package.

## Install or update

When asked to install or update, tell the user to run these commands in their terminal:

```bash
npx --yes --package @codex-complex-prompt/cli-bridge@0.3.1 complex-prompt hook install --dry-run
npx --yes --package @codex-complex-prompt/cli-bridge@0.3.1 complex-prompt hook install
```

The first command previews the changes. The second installs the upstream `UserPromptSubmit` and `Stop` hooks, `$complex-prompt` skill, and compatibility prompt in the active `CODEX_HOME` (normally `~/.codex`). The user runs these commands themselves. The CLI requires Node.js 24 or later and `npx`; it preserves other hooks and refuses to overwrite unrelated skill or prompt files.

After the user reports installation is complete, tell them to restart Codex CLI. If prompted, they should review and trust the new command hook through `/hooks`, start a new thread, and invoke `$complex-prompt`.

If the user previously installed the integration, these commands safely update files managed by the upstream package.

## Remove

When asked to remove the integration, show the user this command to run in their terminal:

```bash
npx --yes --package @codex-complex-prompt/cli-bridge@0.3.1 complex-prompt hook remove
```

The upstream CLI removes only hooks, skill, and prompt files marked as its own. It preserves unrelated hooks and files. Do not run the removal command yourself.

For the full usage and development guide, see the [project README](https://github.com/nayounsang/codex-complex-prompt#readme).
