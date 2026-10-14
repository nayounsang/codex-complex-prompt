import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const packageDir = fileURLToPath(new URL('..', import.meta.url));
const npmCli = join(
  dirname(process.execPath),
  '..',
  'lib',
  'node_modules',
  'npm',
  'bin',
  'npm-cli.js',
);
const temporaryDir = await mkdtemp(join(tmpdir(), 'codex-complex-prompt-pack-'));

try {
  const { stdout } = await execFileAsync(
    process.execPath,
    [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', temporaryDir],
    {
      cwd: packageDir,
    },
  );
  const packResult = JSON.parse(stdout) as Array<{
    filename: string;
    files: Array<{ path: string }>;
  }>;
  const tarball = packResult[0]?.filename;
  if (tarball === undefined) throw new Error('npm pack did not return a tarball.');
  if (packResult[0]?.files.some(({ path }) => path.startsWith('packages/server/')) === true) {
    throw new Error('Installed tarball included the private server workspace package.');
  }
  await execFileAsync(process.execPath, [npmCli, 'init', '--yes'], { cwd: temporaryDir });
  await execFileAsync(
    process.execPath,
    [npmCli, 'install', '--ignore-scripts', join(temporaryDir, tarball)],
    {
      cwd: temporaryDir,
    },
  );
  const packageRoot = join(temporaryDir, 'node_modules/@codex-complex-prompt/cli-bridge');
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
    bin?: Record<string, string>;
    dependencies?: Record<string, string>;
    files?: string[];
  };
  if (packageJson.bin?.['complex-prompt'] !== 'dist/index.js') {
    throw new Error('Installed tarball did not expose the complex-prompt executable.');
  }
  const webIndex = await readFile(join(packageRoot, 'web/dist/index.html'), 'utf8');
  if (!webIndex.includes('Codex')) {
    throw new Error('Installed tarball did not include the packaged web UI.');
  }
  const installedBundle = await readFile(join(packageRoot, 'dist/index.js'), 'utf8');
  if (
    !installedBundle.includes('from "@nestjs/common"') ||
    !installedBundle.includes('from "@nestjs/core"') ||
    !installedBundle.includes('import "reflect-metadata"')
  ) {
    throw new Error('Installed CLI bundle did not leave Nest runtime imports external.');
  }
  for (const dependency of [
    '@nestjs/common',
    '@nestjs/core',
    '@nestjs/platform-express',
    'reflect-metadata',
    'rxjs',
  ]) {
    if (packageJson.dependencies?.[dependency] === undefined) {
      throw new Error(`Installed tarball did not declare ${dependency} as a runtime dependency.`);
    }
  }
  const executable = join(temporaryDir, 'node_modules/.bin/complex-prompt');
  const child = spawn(executable, ['hook', 'prompt'], {
    cwd: temporaryDir,
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}:${process.env['PATH'] ?? ''}`,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end(JSON.stringify({ prompt: '일반 명령' }));
  let childOutput = '';
  const output = new Promise<string>((resolve) => {
    child.stdout.on('data', (chunk: Buffer) => {
      childOutput += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      childOutput += chunk.toString();
    });
    child.on('close', () => resolve(childOutput));
    child.on('error', (error: Error) => {
      childOutput += `${error.stack ?? error.message}\n`;
      resolve(childOutput);
    });
  });
  let timeout: NodeJS.Timeout | undefined;
  let completedOutput: string;
  try {
    completedOutput = await Promise.race([
      output,
      new Promise<string>((_, reject) => {
        timeout = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error('Installed hook command did not exit within 10 seconds.'));
        }, 10_000);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
  if (!completedOutput.includes('"continue":true')) {
    throw new Error(`Installed hook command returned an unexpected result.\n${completedOutput}`);
  }

  const installedMain = pathToFileURL(join(packageRoot, 'dist/index.js')).href;
  const serverSmoke = `
    import { startCliBridge } from ${JSON.stringify(installedMain)};
    const bridge = await startCliBridge({ openBrowser: async () => {} });
    try {
      const response = await fetch(bridge.server.url);
      const body = await response.text();
      if (response.status !== 200 || !body.includes('Codex')) {
        throw new Error('Installed Nest server returned an unexpected response.');
      }
    } finally {
      await bridge.stop();
    }
  `;
  await execFileAsync(process.execPath, ['--input-type=module', '-e', serverSmoke], {
    cwd: temporaryDir,
    timeout: 10_000,
  });
  process.stdout.write('CLI package smoke test passed.\n');
} finally {
  await rm(temporaryDir, { recursive: true, force: true });
}
