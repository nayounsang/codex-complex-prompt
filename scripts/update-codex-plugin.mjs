import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const marketplacePath = `${repositoryRoot}.agents/plugins/marketplace.json`;
const pluginName = 'younsang-codex-plugin';
const upstreamRepository = 'https://github.com/nayounsang/younsang-codex-plugin.git';
const upstreamRef = 'refs/heads/main';

const remoteResult = execFileSync('git', ['ls-remote', upstreamRepository, upstreamRef], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
const latestSha = remoteResult.trim().split(/\s+/)[0];

if (!/^[0-9a-f]{40}$/.test(latestSha ?? '')) {
  throw new Error(`Could not resolve a 40-character commit SHA for ${upstreamRef}.`);
}

const marketplace = JSON.parse(await readFile(marketplacePath, 'utf8'));
const plugins = marketplace.plugins?.filter((plugin) => plugin.name === pluginName) ?? [];

if (plugins.length !== 1 || typeof plugins[0].source !== 'object' || plugins[0].source === null) {
  throw new Error(`Expected exactly one ${pluginName} entry with a source in ${marketplacePath}.`);
}

const source = plugins[0].source;
const currentSha = source.sha ?? source.ref;

if (currentSha === latestSha) {
  console.log(`${pluginName} is already pinned to ${latestSha}.`);
  process.exit(0);
}

delete source.ref;
source.sha = latestSha;

await writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);
console.log(`Updated ${pluginName} pin: ${currentSha ?? '(unset)'} -> ${latestSha}.`);
