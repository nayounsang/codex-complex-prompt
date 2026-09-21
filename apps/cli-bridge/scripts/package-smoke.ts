import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const packResult = JSON.parse(stdout) as Array<{ filename: string }>;
  const tarball = packResult[0]?.filename;
  if (tarball === undefined) throw new Error('npm pack did not return a tarball.');
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
    files?: string[];
  };
  if (packageJson.bin?.['complex-prompt'] !== 'dist/index.js') {
    throw new Error('Installed tarball did not expose the complex-prompt executable.');
  }
  const webIndex = await readFile(join(packageRoot, 'web/dist/index.html'), 'utf8');
  if (!webIndex.includes('Codex')) {
    throw new Error('Installed tarball did not include the packaged web UI.');
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
  process.stdout.write('CLI package smoke test passed.\n');
} finally {
  await rm(temporaryDir, { recursive: true, force: true });
}
