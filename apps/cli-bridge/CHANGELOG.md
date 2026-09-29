# @codex-complex-prompt/cli-bridge

## 0.3.3

### Patch Changes

- 4d1325c: Fix Mermaid preview actions and the diagram type selector in the editor dialog.

## 0.3.2

### Patch Changes

- d0044b3: Save pasted and dropped prompt images with their original format as project attachments and reference them from Markdown.

## 0.3.1

### Patch Changes

- 93f59cc: Include edited Markdown in AI feedback and reopen the browser editor for iterative review.
- d586ec5: Keep Plannotator from opening during Complex Prompt feedback loops and hand submitted Plan Mode requests back for plan review.
- f4255a2: Allow users to select read-only drawing attachments for targeted AI feedback.
- daaceb5: Keep browser bridge sessions alive for up to 3 days so they do not expire before the Codex hook timeout.
- 6a04e70: Add Excalidraw drawing attachments to prompt Markdown and preserve them during AI feedback sessions.

## 0.3.0

### Minor Changes

- 423c13d: Add AI Feedback Mode with global and selection annotations, feedback submission, and updated Markdown session reopening.

## 0.2.0

### Minor Changes

- ed700b6: Package the browser bridge as an installable CLI and add a Codex UserPromptSubmit command editor.
