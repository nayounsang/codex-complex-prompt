import { chmod, cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspaceWebDist = join(packageDir, '..', 'web', 'dist');
const packagedWebDist = join(packageDir, 'web', 'dist');
const entrypoint = join(packageDir, 'dist', 'index.js');
const externalPackages = [
  '@file-type/xml',
  '@nestjs/common',
  '@nestjs/core',
  '@nestjs/platform-express',
  'execa',
  'file-type',
  'mime',
  'open',
  'reflect-metadata',
  'rxjs',
  'ws',
];
const packageJson = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};
const undeclaredExternals = externalPackages.filter(
  (packageName) => packageJson.dependencies?.[packageName] === undefined,
);
if (undeclaredExternals.length > 0) {
  throw new Error(
    `External runtime packages must be direct production dependencies: ${undeclaredExternals.join(', ')}`,
  );
}

await rm(packagedWebDist, { recursive: true, force: true });
await mkdir(dirname(packagedWebDist), { recursive: true });
await cp(workspaceWebDist, packagedWebDist, { recursive: true });
await build({
  bundle: true,
  entryPoints: [entrypoint],
  external: externalPackages,
  format: 'esm',
  outfile: entrypoint,
  platform: 'node',
  sourcemap: true,
  allowOverwrite: true,
});
await chmod(entrypoint, 0o755);
