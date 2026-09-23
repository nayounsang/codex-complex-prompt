import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __e2eCloseRequests: number[];
  }
}

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const fakeCodexPath = join(repositoryRoot, 'e2e/fixtures/fake-codex.mjs');
const cliPath = join(repositoryRoot, 'apps/cli-bridge/dist/index.js');

interface HookResult {
  readonly output: string;
  readonly exitCode: number;
}

interface FakeCodexRun {
  readonly browserUrl: Promise<string>;
  readonly result: Promise<HookResult>;
}

function startFakeCodex(
  hook: 'prompt' | 'stop',
  input: unknown,
  codexHome: string,
  browserUrlFile: string,
): FakeCodexRun {
  const childProcess = spawn(process.execPath, [fakeCodexPath, 'hook', hook], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      COMPLEX_PROMPT_CLI_PATH: cliPath,
      COMPLEX_PROMPT_BROWSER_URL_FILE: browserUrlFile,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines = createInterface({ input: childProcess.stdout });
  let resolveBrowserUrl: (url: string) => void = () => undefined;
  let resolveResult: (result: HookResult) => void = () => undefined;
  const browserUrl = new Promise<string>((resolveUrl) => {
    resolveBrowserUrl = resolveUrl;
  });
  const result = new Promise<HookResult>((resolveResultPromise) => {
    resolveResult = resolveResultPromise;
  });
  lines.on('line', (line) => {
    const event = JSON.parse(line) as
      | { readonly type: 'browser.url'; readonly url: string }
      | { readonly type: 'hook.output'; readonly output: string; readonly exitCode: number };
    if (event.type === 'browser.url') resolveBrowserUrl(event.url);
    else resolveResult({ output: event.output, exitCode: event.exitCode });
  });
  childProcess.stdin.end(JSON.stringify(input));
  return { browserUrl, result };
}

async function observeBrowserClose(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.assign(window, { __e2eCloseRequests: [] as number[] });
    Object.defineProperty(window, 'close', {
      configurable: true,
      value: () => window.__e2eCloseRequests.push(performance.now()),
    });
  });
}

async function expectBrowserCloseAfterThreeSeconds(page: Page, submittedAt: number): Promise<void> {
  await page.waitForFunction(() => {
    return window.__e2eCloseRequests.length === 1;
  });
  const closeDelay = await page.evaluate((submitted) => {
    return window.__e2eCloseRequests[0]! - submitted;
  }, submittedAt);
  expect(closeDelay).toBeGreaterThanOrEqual(2_800);
  expect(closeDelay).toBeLessThan(4_500);
}

async function openFakeCodexBrowser(page: Page, run: FakeCodexRun): Promise<void> {
  await observeBrowserClose(page);
  await page.goto(await run.browserUrl);
  await expect(page.getByRole('status')).toContainText('Connected');
  await page.evaluate(() => {
    window.__e2eCloseRequests = [];
    Object.defineProperty(window, 'close', {
      configurable: true,
      value: () => window.__e2eCloseRequests.push(performance.now()),
    });
  });
}

test('입력한 Markdown을 Codex에 전달하고 3초 뒤 브라우저 종료를 요청한다', async ({ page }) => {
  const codexHome = await mkdtemp(join(tmpdir(), 'complex-prompt-e2e-input-'));
  const browserUrlFile = join(codexHome, 'browser-url.txt');
  const inputMarkdown = 'Input draft with one original item';
  const submittedMarkdown = 'Revised draft with one checked item';
  const fakeCodex = startFakeCodex(
    'prompt',
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'e2e-input-session',
      cwd: repositoryRoot,
      prompt: `$complex-prompt ${inputMarkdown}`,
    },
    codexHome,
    browserUrlFile,
  );

  try {
    await openFakeCodexBrowser(page, fakeCodex);
    const editor = page.getByRole('textbox', { name: 'Command' });
    await expect(editor).toContainText('Input draft');
    await editor.fill(submittedMarkdown);
    const submittedAt = await page.evaluate(() => performance.now());
    await page.getByRole('button', { name: 'Send to Codex' }).click();

    const hookResult = await fakeCodex.result;
    expect(hookResult.exitCode).toBe(0);
    const response = JSON.parse(hookResult.output) as {
      readonly hookSpecificOutput: { readonly additionalContext: string };
    };
    expect(response.hookSpecificOutput.additionalContext).toContain(submittedMarkdown);
    await expectBrowserCloseAfterThreeSeconds(page, submittedAt);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test('Feedback 제출 후 같은 Codex 세션의 개선 문서를 다시 열고 3초 뒤 종료한다', async ({
  page,
}) => {
  const codexHome = await mkdtemp(join(tmpdir(), 'complex-prompt-e2e-feedback-'));
  const browserUrlFile = join(codexHome, 'prompt-browser-url.txt');
  const originalMarkdown = '# Review draft\n\nKeep this paragraph.';
  const promptRun = startFakeCodex(
    'prompt',
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'e2e-feedback-session',
      cwd: repositoryRoot,
      prompt: `$complex-prompt ${originalMarkdown}`,
    },
    codexHome,
    browserUrlFile,
  );

  try {
    await openFakeCodexBrowser(page, promptRun);
    await page.getByRole('tab', { name: 'AI Feedback Mode' }).click();
    await page.getByRole('button', { name: 'Add global feedback' }).click();
    await page.getByRole('textbox', { name: 'Global feedback' }).fill('Clarify the result.');
    await page.getByRole('button', { name: 'Add feedback' }).click();
    const feedbackSubmittedAt = await page.evaluate(() => performance.now());
    await page.getByRole('button', { name: 'Send Feedback' }).click();

    const feedbackResult = await promptRun.result;
    expect(feedbackResult.exitCode).toBe(0);
    const feedbackResponse = JSON.parse(feedbackResult.output) as {
      readonly hookSpecificOutput: { readonly additionalContext: string };
    };
    expect(feedbackResponse.hookSpecificOutput.additionalContext).toContain('Clarify the result.');
    expect(feedbackResponse.hookSpecificOutput.additionalContext).toContain(originalMarkdown);
    await expectBrowserCloseAfterThreeSeconds(page, feedbackSubmittedAt);

    const improvedMarkdown = '# Improved review\n\nThe result is now clear.';
    const stopUrlFile = join(codexHome, 'stop-browser-url.txt');
    const stopRun = startFakeCodex(
      'stop',
      {
        hook_event_name: 'Stop',
        session_id: 'e2e-feedback-session',
        cwd: repositoryRoot,
        last_assistant_message: improvedMarkdown,
        stop_hook_active: false,
      },
      codexHome,
      stopUrlFile,
    );
    const reopenedPage = await page.context().newPage();
    await openFakeCodexBrowser(reopenedPage, stopRun);
    const editor = reopenedPage.getByRole('textbox', { name: 'Command' });
    await expect(editor).toContainText('Improved review');
    const stopSubmittedAt = await reopenedPage.evaluate(() => performance.now());
    await reopenedPage.getByRole('button', { name: 'Send to Codex' }).click();

    const stopResult = await stopRun.result;
    expect(stopResult.exitCode).toBe(0);
    const response = JSON.parse(stopResult.output) as {
      readonly decision: string;
      readonly reason: string;
    };
    expect(response.decision).toBe('block');
    expect(response.reason).toContain(improvedMarkdown);
    await expectBrowserCloseAfterThreeSeconds(reopenedPage, stopSubmittedAt);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});
