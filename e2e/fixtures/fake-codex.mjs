import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';

const cliPath = process.env['COMPLEX_PROMPT_CLI_PATH'];
const browserUrlFile = process.env['COMPLEX_PROMPT_BROWSER_URL_FILE'];
if (cliPath === undefined || browserUrlFile === undefined) {
  throw new Error('Fake Codex requires a CLI entrypoint and browser URL file.');
}

let hookInput = '';
for await (const chunk of process.stdin) hookInput += chunk;

const hook = spawn(process.execPath, [cliPath, ...process.argv.slice(2)], {
  env: process.env,
  stdio: ['pipe', 'pipe', 'inherit'],
});
hook.stdin.end(hookInput);

let browserUrlSent = false;
const pollUrl = setInterval(() => {
  void access(browserUrlFile)
    .then(async () => {
      if (browserUrlSent) return;
      browserUrlSent = true;
      clearInterval(pollUrl);
      process.stdout.write(
        `${JSON.stringify({ type: 'browser.url', url: await readFile(browserUrlFile, 'utf8') })}\n`,
      );
    })
    .catch(() => undefined);
}, 25);

let hookOutput = '';
for await (const chunk of hook.stdout) hookOutput += chunk;
const exitCode = await new Promise((resolve) => hook.once('close', resolve));
clearInterval(pollUrl);
process.stdout.write(`${JSON.stringify({ type: 'hook.output', output: hookOutput, exitCode })}\n`);
if (exitCode !== 0) process.exitCode = Number(exitCode) || 1;
