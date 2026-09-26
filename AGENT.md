- Before pushing any changes, run the same validation steps used by CI and ensure they pass in the local.

- When modifying or adding a user-facing feature, verify the resulting behavior through `computer use`. Follow the setup instructions in `README.md`. If `computer use` is unavailable, use either `chrome devtool MCP` or `playwright MCP` instead. At least one of these verification methods must be used.

- When a change affects behavior that is shipped to production, add a changeset describing the change.

- Aim to maintain 100% test coverage. New or modified behavior must be covered by tests unless there is a clear reason why automated testing is impractical.

- Organize files by domain within each package. Within a domain, further group files by purpose, such as `utils`, `hooks`, or similar categories, when multiple files serve the same purpose. Do not create a category directory for a single file. Once a category contains two or more files, create the corresponding directory and move those files into it.
