import { chmod, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const packageDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspaceWebDist = join(packageDir, '..', 'web', 'dist');
const packagedWebDist = join(packageDir, 'web', 'dist');
const entrypoint = join(packageDir, 'dist', 'index.js');

await rm(packagedWebDist, { recursive: true, force: true });
await mkdir(dirname(packagedWebDist), { recursive: true });
await cp(workspaceWebDist, packagedWebDist, { recursive: true });
await build({
  bundle: true,
  entryPoints: [entrypoint],
  external: ['execa', 'open', 'ws'],
  format: 'esm',
  outfile: entrypoint,
  platform: 'node',
  sourcemap: true,
  allowOverwrite: true,
});
await chmod(entrypoint, 0o755);
