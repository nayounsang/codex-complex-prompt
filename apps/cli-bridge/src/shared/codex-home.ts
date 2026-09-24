import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultCodexHome(): string {
  return process.env['CODEX_HOME'] ?? join(homedir(), '.codex');
}
