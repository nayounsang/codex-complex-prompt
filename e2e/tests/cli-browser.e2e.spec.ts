import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

test('Markdown 이미지·비디오·빈 경로·로드 오류를 공용 미디어 렌더러로 표시한다', async ({
  page,
}) => {
  const codexHome = await mkdtemp(join(tmpdir(), 'complex-prompt-e2e-media-'));
  const browserUrlFile = join(codexHome, 'browser-url.txt');
  const photoUrl = 'https://media.test/photo.PNG?size=2#preview';
  const videoUrl = 'https://media.test/clip.webm?download=1#t=4';
  const originalMarkdown = [
    `![Photo](${photoUrl})`,
    `![](${videoUrl})`,
    '![](https://media.test/broken.png)',
    '![](https://media.test/unsupported.avi)',
    '![]()',
  ].join('\n\n');
  const fakeCodex = startFakeCodex(
    'prompt',
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'e2e-media-renderer-session',
      cwd: repositoryRoot,
      prompt: `$complex-prompt ${originalMarkdown}`,
    },
    codexHome,
    browserUrlFile,
  );
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('https://media.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/broken.png')) {
      await route.abort();
      return;
    }
    if (url.pathname.endsWith('/photo.PNG')) {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
          'base64',
        ),
      });
      return;
    }
    if (url.pathname.endsWith('/clip.webm')) {
      await route.fulfill({
        status: 200,
        contentType: 'video/webm',
        body: Buffer.from(
          'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAALIEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggKy7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjIuMy4xMDBXQYxMYXZmNjIuMy4xMDBEiYhAaQAAAAAAABZUrmvIrgEAAAAAAAA/14EBc8WIZvwfe4KLkGOcgQAitZyDdW5kiIEAhoVWX1ZQOIOBASPjg4QCYloA4JCwgSC6gRKagQJVsIRVuYEBElTDZ/tzc59jwIBnyJlFo4dFTkNPREVSRIeMTGF2ZjYyLjMuMTAwc3PWY8CLY8WIZvwfe4KLkGNnyKFFo4dFTkNPREVSRIeUTGF2YzYyLjExLjEwMCBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAwLjIwMDAwMDAwMAAfQ7Z1QQnngQCjvoEAAIAQAwCdASogABIAAEcIhYWImYSIAgICdaoD+AP6AghZLpBw/v1u8//kb+PnRv/I4//8Sp7jieP//EaAo6yBACgA0QEAARA8ABgAHlf0DABBDgD+9hNf/n5QX1ZX1v16//XmAhdw7/11oKOugQBQANEBAAEQLAAYAB5X9AwAQQ4A/vi1F/9ZT1/ZT1/ZX++R/+88yhVUc/7ywKO0gQB4APEBAAEQIAAYC7APkNuUcEN7AP77Lkv/uPxX/H4r/kA/hP//z1kFQvO//PLzKVLwAKOwgQCgANEBAAEQGAAYAB5X9AwAQQ4A/vwNo//ee1X/ntV/58/6M//9XQxmLvH/6swAHFO7a5G7j7OBALeK94EB8YIBo/CBAw==',
          'base64',
        ),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: 'unsupported',
    });
  });
  const photoResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/photo.PNG'),
  );
  const videoResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/clip.webm'),
  );

  try {
    await openFakeCodexBrowser(page, fakeCodex);
    const editor = page.getByTestId('markdown-editor');
    const photo = editor.locator('.media-embed-frame img[alt="Photo"]');
    await expect(photo).toBeVisible();
    await expect(photo).toHaveAttribute('src', photoUrl);
    expect((await photoResponse).status()).toBe(200);

    const video = editor.locator('.media-embed-frame video');
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute('src', videoUrl);
    await expect(video).toHaveAttribute('controls', '');
    expect((await videoResponse).status()).toBe(200);

    const addMediaButton = editor.getByRole('button', { name: 'Add media' });
    await expect(addMediaButton).toBeVisible();
    await expect(addMediaButton).toBeEnabled();
    await expect(
      editor.locator('.media-embed-status').filter({ hasText: 'Media unavailable' }),
    ).toHaveCount(2);
    expect(pageErrors).toEqual([]);
    await page.getByRole('button', { name: 'Send to Codex' }).click();
    expect((await fakeCodex.result).exitCode).toBe(0);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});

test('null appState가 저장된 Excalidraw 장면을 편집할 수 있다', async ({ page }) => {
  const codexHome = await mkdtemp(join(tmpdir(), 'complex-prompt-e2e-null-app-state-'));
  const projectDirectory = join(codexHome, 'project');
  const browserUrlFile = join(codexHome, 'browser-url.txt');
  const attachmentId = '00000000-0000-4000-8000-000000000041';
  const attachmentDirectory = join(projectDirectory, '.complex-prompt', 'attachments');
  await mkdir(attachmentDirectory, { recursive: true });
  await writeFile(
    join(attachmentDirectory, `${attachmentId}.png`),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  await writeFile(
    join(attachmentDirectory, `${attachmentId}.excalidraw.json`),
    JSON.stringify({ elements: [], appState: null, files: {} }),
  );
  const fakeCodex = startFakeCodex(
    'prompt',
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'e2e-null-app-state-session',
      cwd: projectDirectory,
      prompt: `$complex-prompt ![Drawing](.complex-prompt/attachments/${attachmentId}.png)`,
    },
    codexHome,
    browserUrlFile,
  );
  let submitted = false;

  try {
    await openFakeCodexBrowser(page, fakeCodex);
    const editor = page.getByRole('textbox', { name: 'Command' });
    const drawing = editor.getByRole('button', { name: 'Drawing actions: Drawing' });
    await expect(drawing).toBeVisible();
    await drawing.hover();
    await page.getByRole('button', { name: 'Edit drawing' }).click();
    await expect(page.getByRole('heading', { name: 'Draw' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Insert' })).toBeEnabled();
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Send to Codex' }).click();
    submitted = true;
    expect((await fakeCodex.result).exitCode).toBe(0);
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
