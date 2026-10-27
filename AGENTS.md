# Agent instructions

- Follow [docs/development.md](docs/development.md) for repository structure, setup, checks, end-to-end workflows, and releases.
- For changes shipped in published packages—including changes from private packages bundled into them—add a changeset for each affected published package.
- Verify user-visible flows with Computer Use, Chrome DevTools MCP, or Playwright after implementing user-visible behavior.
- Prefer unit and integration tests; write end-to-end tests only for core product behavior that needs end-to-end coverage.
- Keep files grouped by domain within each package; avoid creating one-off category directories.
- Before pushing code changes, use `$strict-review` and report result. After that, if the user gives the instruction to push, then perform the push.
- Before pushing documentation(including jsDoc) changes, use `$dev-docs-review` and report result. After that, if the user gives the instruction to push, then perform the push.
- When preparing PR Markdown, use `$write-pr-content`.
- For setting API loading/error and special response scenarios, use `$api-scenario-forge`
