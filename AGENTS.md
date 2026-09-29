# Agent instructions

- Follow [docs/development.md](docs/development.md) for repository structure, setup, checks, end-to-end workflows, and releases.
- For shipped behavior, add a changeset.
- Verify user-visible flows with Computer Use, Chrome DevTools MCP, or Playwright after implement user-effect logic
- Keep files grouped by domain within each package; avoid creating one-off category directories.
- Before pushing code changes, use `$strict-review` and resolve actionable findings.
- Before pushing developer documentation changes, use `$dev-docs-review` and resolve supported findings.
- When preparing PR Markdown, use `$write-pr-content`.
- For setting API loading/error and special response scenarios, use `$api-scenario-forge`
