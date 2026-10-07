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
    await editor.press('ControlOrMeta+A');
    await editor.pressSequentially(submittedMarkdown);
    await expect(editor).toContainText(submittedMarkdown);
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

test('이미지 저장을 기다린 뒤 첨부 링크가 포함된 Markdown을 Codex에 전달한다', async ({ page }) => {
  const codexHome = await mkdtemp(join(tmpdir(), 'complex-prompt-e2e-image-submit-'));
  const browserUrlFile = join(codexHome, 'browser-url.txt');
  const fakeCodex = startFakeCodex(
    'prompt',
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'e2e-image-submit-session',
      cwd: repositoryRoot,
      prompt: '$complex-prompt Review this image',
    },
    codexHome,
    browserUrlFile,
  );
  const uploadStarted = new Promise<void>((resolveUploadStarted) => {
    page.route('**/_complex-prompt/attachments**', async (route) => {
      resolveUploadStarted();
      await uploadGate;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'e2e-image', extension: 'gif' }),
      });
    });
  });
  let releaseUpload!: () => void;
  const uploadGate = new Promise<void>((resolveUpload) => {
    releaseUpload = resolveUpload;
  });
  let submitted = false;

  try {
    await openFakeCodexBrowser(page, fakeCodex);
    const editor = page.getByRole('textbox', { name: 'Command' });
    await expect(editor).toContainText('Review this image');
    await editor.evaluate((element) => {
      const bytes = Uint8Array.from(atob('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='), (character) =>
        character.charCodeAt(0),
      );
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'pasted.gif', { type: 'image/gif' }));
      element.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }),
      );
    });
    await uploadStarted;

    const updatedPrompt = 'Review this image with the latest notes';
    await editor.press('ControlOrMeta+A');
    await editor.pressSequentially(updatedPrompt);
    await expect(editor).toContainText(updatedPrompt);
    await page.getByRole('button', { name: 'Send to Codex' }).click();
    await expect(page.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    releaseUpload();

    const hookResult = await fakeCodex.result;
    submitted = true;
    expect(hookResult.exitCode).toBe(0);
    const response = JSON.parse(hookResult.output) as {
      readonly hookSpecificOutput: { readonly additionalContext: string };
    };
    expect(response.hookSpecificOutput.additionalContext).toContain(
      '![pasted.gif](.complex-prompt/attachments/e2e-image.gif)',
    );
    expect(response.hookSpecificOutput.additionalContext).toContain(updatedPrompt);
  } finally {
    releaseUpload();
    if (!submitted) {
      await page
        .getByRole('button', { name: 'Send to Codex' })
        .click({ timeout: 1_000 })
        .catch(() => undefined);
      await Promise.race([fakeCodex.result, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
    await rm(codexHome, { recursive: true, force: true });
  }
});

test('이미지 안의 삭제 버튼을 눌러 첨부 이미지를 삭제한다', async ({ page }) => {
  const codexHome = await mkdtemp(join(tmpdir(), 'complex-prompt-e2e-image-delete-'));
  const browserUrlFile = join(codexHome, 'browser-url.txt');
  const imageId = '00000000-0000-4000-8000-000000000009';
  const fakeCodex = startFakeCodex(
    'prompt',
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'e2e-image-delete-session',
      cwd: repositoryRoot,
      prompt: `$complex-prompt Review this image\n\n![image](.complex-prompt/attachments/${imageId}.png)`,
    },
    codexHome,
    browserUrlFile,
  );
  let submitted = false;

  try {
    await page.route('**/_complex-prompt/attachments/**', async (route) => {
      const request = route.request();
      if (request.method() === 'HEAD') {
        await route.fulfill({ status: 200, headers: { 'X-Attachment-Editable': 'false' } });
      } else if (request.method() === 'DELETE') {
        await route.fulfill({ status: 204 });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" />',
        });
      }
    });
    await openFakeCodexBrowser(page, fakeCodex);
    const editor = page.getByRole('textbox', { name: 'Command' });
    const image = editor.locator(`img[data-drawing-id="${imageId}"]`);
    await expect(image).toBeVisible();
    await image.hover();

    const deleteButton = page.getByRole('button', { name: 'Delete drawing' });
    await expect(deleteButton).toBeVisible();
    const imageBounds = await image.boundingBox();
    const buttonBounds = await deleteButton.boundingBox();
    expect(imageBounds).not.toBeNull();
    expect(buttonBounds).not.toBeNull();
    expect(buttonBounds!.x).toBeGreaterThanOrEqual(imageBounds!.x);
    expect(buttonBounds!.y).toBeGreaterThanOrEqual(imageBounds!.y);
    expect(buttonBounds!.x + buttonBounds!.width).toBeLessThanOrEqual(
      imageBounds!.x + imageBounds!.width,
    );
    expect(buttonBounds!.y + buttonBounds!.height).toBeLessThanOrEqual(
      imageBounds!.y + imageBounds!.height,
    );

    await deleteButton.hover();
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();
    await expect(image).toHaveCount(0);
    await page.getByRole('button', { name: 'Send to Codex' }).click();

    const hookResult = await fakeCodex.result;
    submitted = true;
    expect(hookResult.exitCode).toBe(0);
    const response = JSON.parse(hookResult.output) as {
      readonly hookSpecificOutput: { readonly additionalContext: string };
    };
    expect(response.hookSpecificOutput.additionalContext).not.toContain(imageId);
  } finally {
    if (!submitted) {
      await page
        .getByRole('button', { name: 'Send to Codex' })
        .click({ timeout: 1_000 })
        .catch(() => undefined);
      await Promise.race([fakeCodex.result, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
    await rm(codexHome, { recursive: true, force: true });
  }
});

test('이미지 저장 실패 시 fallback 이미지를 보여주고 Markdown에 연결한다', async ({ page }) => {
  const codexHome = await mkdtemp(join(tmpdir(), 'complex-prompt-e2e-image-fallback-'));
  const browserUrlFile = join(codexHome, 'browser-url.txt');
  const fakeCodex = startFakeCodex(
    'prompt',
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'e2e-image-fallback-session',
      cwd: repositoryRoot,
      prompt: '$complex-prompt Review this image',
    },
    codexHome,
    browserUrlFile,
  );
  let submitted = false;

  try {
    await page.route('**/_complex-prompt/attachments**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Could not save pasted.gif.' }),
      }),
    );
    await openFakeCodexBrowser(page, fakeCodex);
    const editor = page.getByRole('textbox', { name: 'Command' });
    const uploadFailed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/_complex-prompt/attachments'),
    );
    await editor.evaluate((element) => {
      const bytes = Uint8Array.from(atob('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='), (character) =>
        character.charCodeAt(0),
      );
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'pasted.gif', { type: 'image/gif' }));
      element.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }),
      );
    });
    expect((await uploadFailed).status()).toBe(500);

    const fallbackImage = page.getByRole('img', { name: 'Image upload failed: pasted.gif' });
    await expect(fallbackImage).toHaveAttribute('src', '/image-upload-failed.svg');
    const assetResponse = await page.request.get(
      new URL('/image-upload-failed.svg', page.url()).href,
    );
    expect(assetResponse.ok()).toBe(true);

    await page.getByRole('button', { name: 'Send to Codex' }).click();
    const hookResult = await fakeCodex.result;
    submitted = true;
    expect(hookResult.exitCode).toBe(0);
    const response = JSON.parse(hookResult.output) as {
      readonly hookSpecificOutput: { readonly additionalContext: string };
    };
    expect(response.hookSpecificOutput.additionalContext).toContain(
      '![Image upload failed: pasted.gif](/image-upload-failed.svg)',
    );
  } finally {
    if (!submitted) {
      await page
        .getByRole('button', { name: 'Send to Codex' })
        .click({ timeout: 1_000 })
        .catch(() => undefined);
      await Promise.race([fakeCodex.result, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
    await rm(codexHome, { recursive: true, force: true });
  }
});

test('Mermaid 코드블록을 클릭하면 다이어그램 편집 다이얼로그를 표시한다', async ({ page }) => {
  const codexHome = await mkdtemp(join(tmpdir(), 'complex-prompt-e2e-mermaid-'));
  const browserUrlFile = join(codexHome, 'browser-url.txt');
  const markdown =
    '```mermaid\ngraph TD\n  A-->B\n```\n\n```mermaid\nsequenceDiagram\n  A->>B: Hello\n```';
  const fakeCodex = startFakeCodex(
    'prompt',
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'e2e-mermaid-session',
      cwd: repositoryRoot,
      prompt: `$complex-prompt ${markdown}`,
    },
    codexHome,
    browserUrlFile,
  );
  let submitted = false;
  const nestedButtonErrors: string[] = [];

  try {
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().includes('cannot be a descendant of'))
        nestedButtonErrors.push(message.text());
    });
    await openFakeCodexBrowser(page, fakeCodex);
    const commandEditor = page.getByRole('textbox', { name: 'Command' });
    await expect(commandEditor).toContainText('graph TD');
    await expect(page.locator('.markdown-editor .mermaid-preview-mount')).toHaveCount(2);
    const editButton = page.getByRole('button', { name: 'Edit diagram' });
    await expect(editButton).toHaveCount(2, { timeout: 5_000 });
    await editButton.first().click();

    const diagramDialog = page.getByRole('dialog');
    await expect(diagramDialog).toBeVisible();
    await expect(diagramDialog.getByRole('combobox', { name: 'Diagram type' })).toBeVisible();
    expect(nestedButtonErrors).toEqual([]);
    await diagramDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.markdown-editor .mermaid-preview-card')).toHaveCount(2);
    await expect(editButton).toHaveCount(2);

    await page.getByRole('button', { name: 'Send to Codex' }).click();
    submitted = true;
    await fakeCodex.result;
  } finally {
    if (!submitted) {
      await page
        .getByRole('button', { name: 'Send to Codex' })
        .click({ timeout: 1_000 })
        .catch(() => undefined);
      await Promise.race([fakeCodex.result, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
    await rm(codexHome, { recursive: true, force: true });
  }
});

test('슬래시 메뉴에서 추가한 빈 다이어그램 블록을 클릭하면 편집 다이얼로그를 표시한다', async ({
  page,
}) => {
  const codexHome = await mkdtemp(join(tmpdir(), 'complex-prompt-e2e-mermaid-empty-'));
  const browserUrlFile = join(codexHome, 'browser-url.txt');
  const fakeCodex = startFakeCodex(
    'prompt',
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'e2e-mermaid-empty-session',
      cwd: repositoryRoot,
      prompt: '$complex-prompt Add a diagram.',
    },
    codexHome,
    browserUrlFile,
  );
  let submitted = false;

  try {
    await openFakeCodexBrowser(page, fakeCodex);
    const commandEditor = page.getByRole('textbox', { name: 'Command' });
    await expect(commandEditor).toContainText('Add a diagram.');
    await commandEditor.click();
    await commandEditor.press('Control+End');
    await commandEditor.press('Enter');
    await commandEditor.type('/');
    await page.getByText('Diagram', { exact: true }).click();

    const editButton = page.getByRole('button', { name: 'Edit Your Diagram' });
    await expect(editButton).toBeVisible();
    await editButton.click();

    const diagramDialog = page.getByRole('dialog');
    await expect(diagramDialog).toBeVisible();
    await expect(diagramDialog.getByRole('heading', { name: 'Edit diagram' })).toBeVisible();
    await diagramDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.markdown-editor .mermaid-preview-card')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Edit Your Diagram' })).toBeVisible();

    await page.getByRole('button', { name: 'Send to Codex' }).click();
    submitted = true;
    await fakeCodex.result;
  } finally {
    if (!submitted) {
      await page
        .getByRole('button', { name: 'Send to Codex' })
        .click({ timeout: 1_000 })
        .catch(() => undefined);
      await Promise.race([fakeCodex.result, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
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
