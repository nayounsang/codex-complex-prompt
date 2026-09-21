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
  const packageJson = JSON.parse(
    await readFile(
      join(temporaryDir, 'node_modules/@codex-complex-prompt/cli-bridge/package.json'),
      'utf8',
    ),
  ) as { bin?: Record<string, string> };
  if (packageJson.bin?.['complex-prompt'] !== 'dist/index.js') {
    throw new Error('Installed tarball did not expose the complex-prompt executable.');
  }
  const executable = join(temporaryDir, 'node_modules/.bin/complex-prompt');
  const child = spawn(executable, [], {
    cwd: temporaryDir,
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}:${process.env['PATH'] ?? ''}`,
      COMPLEX_PROMPT_NO_BROWSER: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Installed CLI did not start.')), 5_000);
    const request = async (): Promise<void> => {
      try {
        const match = /http:\/\/127\.0\.0\.1:\d+/.exec(childOutput);
        if (match !== null) {
          const response = await fetch(`${match[0]}/`);
          if (response.status === 200) {
            clearTimeout(deadline);
            resolve();
            return;
          }
        }
      } catch {
        // The child may still be binding its ephemeral port.
      }
      setTimeout(() => void request(), 50);
    };
    void request();
  }).catch(async (error: unknown) => {
    child.kill('SIGTERM');
    const failedOutput = await output;
    throw new Error(`${String(error)}\n${failedOutput}`);
  });
  child.kill('SIGTERM');
  await output;
  process.stdout.write('CLI package smoke test passed.\n');
} finally {
  await rm(temporaryDir, { recursive: true, force: true });
}
