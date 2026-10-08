#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  installCodexUserPromptHook,
  removeCodexUserPromptHook,
} from './features/setup/hooks/codex-hook-config.js';
import {
  CODEX_COMPLEX_PROMPT_NAME,
  installCodexSkill,
  installCodexPrompt,
  removeCodexSkill,
  removeCodexPrompt,
} from './features/setup/prompts/codex-prompt-config.js';
import { startCliBridge } from './bridge-startup.js';
import {
  hookPlannotatorStopCommand,
  hookPromptCommand,
  hookStopCommand,
  hookWindowsCommand,
  runHookCommand,
} from './hook-command.js';

/* c8 ignore start -- CLI bootstrap is covered by the opt-in smoke test. */
/* c8 ignore next */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (await runHookCommand(args)) return;
  if (
    args[0] === 'hook' &&
    (args[1] === 'install' || args[1] === 'setup') &&
    (args.length === 2 || (args.length === 3 && args[2] === '--dry-run'))
  ) {
    const dryRun = args[2] === '--dry-run';
    const skillResult = await installCodexSkill({ dryRun });
    const promptResult = await installCodexPrompt({ dryRun });
    const result = await installCodexUserPromptHook({
      dryRun,
      command: hookPromptCommand(),
      stopCommand: hookStopCommand(),
      plannotatorStopCommand: hookPlannotatorStopCommand(),
      ...(process.platform === 'win32'
        ? {
            commandWindows: hookWindowsCommand('prompt'),
            stopCommandWindows: hookWindowsCommand('stop'),
            plannotatorStopCommandWindows: hookWindowsCommand('plannotator-stop'),
          }
        : {}),
    });
    process.stdout.write(
      `${dryRun ? (result.changed ? 'Would install' : 'Already installed') : result.changed ? 'Installed' : 'Already installed'} Codex UserPromptSubmit and Stop hooks in ${result.configPath}.\n`,
    );
    process.stdout.write(
      `${dryRun ? (skillResult.changed ? 'Would install' : 'Already installed') : skillResult.changed ? 'Installed' : 'Already installed'} $${CODEX_COMPLEX_PROMPT_NAME} skill in ${skillResult.skillPath}.\n`,
    );
    process.stdout.write(
      `${dryRun ? (promptResult.changed ? 'Would install' : 'Already installed') : promptResult.changed ? 'Installed' : 'Already installed'} compatibility prompt in ${promptResult.promptPath}.\n`,
    );
    if (dryRun)
      process.stdout.write(
        `${JSON.stringify({ config: result.config, skill: skillResult.content, prompt: promptResult.content }, null, 2)}\n`,
      );
    return;
  }
  if (
    args[0] === 'hook' &&
    (args[1] === 'remove' || args[1] === 'uninstall') &&
    (args.length === 2 || (args.length === 3 && args[2] === '--dry-run'))
  ) {
    const dryRun = args[2] === '--dry-run';
    const result = await removeCodexUserPromptHook({
      dryRun,
      command: hookPromptCommand(),
      stopCommand: hookStopCommand(),
    });
    process.stdout.write(
      `${dryRun ? (result.changed ? 'Would remove' : 'No matching') : result.changed ? 'Removed' : 'No matching'} Codex UserPromptSubmit and Stop hooks in ${result.configPath}.\n`,
    );
    const skillResult = await removeCodexSkill({ dryRun });
    process.stdout.write(
      `${dryRun ? (skillResult.changed ? 'Would remove' : 'No matching') : skillResult.changed ? 'Removed' : 'No matching'} $${CODEX_COMPLEX_PROMPT_NAME} skill in ${skillResult.skillPath}.\n`,
    );
    const promptResult = await removeCodexPrompt({ dryRun });
    process.stdout.write(
      `${dryRun ? (promptResult.changed ? 'Would remove' : 'No matching') : promptResult.changed ? 'Removed' : 'No matching'} compatibility prompt in ${promptResult.promptPath}.\n`,
    );
    if (dryRun)
      process.stdout.write(
        `${JSON.stringify({ config: result.config, skill: skillResult.content, prompt: promptResult.content }, null, 2)}\n`,
      );
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      'Usage: complex-prompt [hook prompt|hook stop|hook install|hook remove]\n\n' +
        'Open a browser command editor for $complex-prompt and manage its Codex hook and skill.\n',
    );
    return;
  }
  if (args.length > 0) {
    process.stderr.write(`Unknown command: ${args.join(' ')}\n`);
    process.exitCode = 1;
    return;
  }
  if (args.length === 0) {
    process.stderr.write(
      'This CLI is opened by the installed Codex UserPromptSubmit hook. ' +
        'Run `complex-prompt hook install` first, then invoke $complex-prompt in Codex.\n',
    );
    process.exitCode = 1;
    return;
  }
  const webUrl = process.env['COMPLEX_PROMPT_WEB_URL'];
  const bridge = await startCliBridge({
    ...(webUrl === undefined ? {} : { webUrl }),
    ...(process.env['COMPLEX_PROMPT_NO_BROWSER'] === '1'
      ? { openBrowser: () => Promise.reject(new Error('Browser opening disabled.')) }
      : {}),
  });
  if (bridge.browserOpened) {
    process.stdout.write('Browser opening was successful.\n');
  } else {
    process.stdout.write(
      `Browser could not be opened. Open this URL manually:\n${bridge.browserUrl}\n`,
    );
  }

  /* c8 ignore next -- signal shutdown is exercised by the opt-in smoke environment. */
  const shutdown = (): void => {
    void bridge.stop().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (isCliEntrypoint()) {
  void main();
}

function isCliEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  if (entrypoint === undefined) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(entrypoint);
  } catch {
    return false;
  }
}
/* c8 ignore stop */

export { startCliBridge, type CliBridgeOptions, type RunningCliBridge } from './bridge-startup.js';
export {
  CodexSessionInputAdapter,
  MockCodexSessionInputAdapter,
} from './features/input/adapters/codex-session-input.js';
export {
  installCodexUserPromptHook,
  removeCodexUserPromptHook,
  type CodexHookConfigOptions,
  type CodexHookConfigResult,
} from './features/setup/hooks/codex-hook-config.js';
export { runCodexStopHook } from './features/feedback/hooks/codex-stop-hook.js';
export {
  CODEX_COMPLEX_PROMPT_CONTENT,
  CODEX_COMPLEX_PROMPT_FILE_MARKER,
  CODEX_COMPLEX_PROMPT_NAME,
  CODEX_COMPLEX_SKILL_CONTENT,
  CODEX_COMPLEX_SKILL_FILE_MARKER,
  defaultCodexPromptPath,
  defaultCodexSkillPath,
  installCodexSkill,
  installCodexPrompt,
  removeCodexSkill,
  removeCodexPrompt,
  type CodexPromptConfigOptions,
  type CodexPromptConfigResult,
  type CodexSkillConfigOptions,
  type CodexSkillConfigResult,
} from './features/setup/prompts/codex-prompt-config.js';
export {
  parseCodexUserPromptHookInput,
  runCodexUserPromptHook,
  type CodexUserPromptHookOutput,
  type RunCodexUserPromptHookOptions,
} from './features/input/hooks/codex-user-prompt-hook.js';
