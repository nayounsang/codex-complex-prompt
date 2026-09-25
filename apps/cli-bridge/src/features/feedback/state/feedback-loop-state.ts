import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { defaultCodexHome } from '../../../shared/codex-home.js';

export interface FeedbackLoopStateStore {
  activate: (sessionId: string | undefined, cwd?: string) => Promise<boolean>;
  isActive: (sessionId: string | undefined) => Promise<boolean>;
  getCwd?: (sessionId: string | undefined) => Promise<string | undefined>;
  clear: (sessionId: string | undefined) => Promise<void>;
}

export function createFeedbackLoopStateStore(
  directory = join(defaultCodexHome(), 'state', 'complex-prompt'),
): FeedbackLoopStateStore {
  return {
    activate: async (sessionId, cwd) => {
      const path = statePath(directory, sessionId);
      if (path === undefined) return false;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const projectDirectory = cwd === undefined || cwd.trim() === '' ? undefined : cwd.trim();
      await writeFile(
        path,
        JSON.stringify({
          sessionId,
          ...(projectDirectory === undefined ? {} : { cwd: projectDirectory }),
        }),
        {
          encoding: 'utf8',
          mode: 0o600,
        },
      );
      return true;
    },
    isActive: async (sessionId) => {
      const path = statePath(directory, sessionId);
      if (path === undefined) return false;
      try {
        const state: unknown = JSON.parse(await readFile(path, 'utf8'));
        return (
          state !== null &&
          typeof state === 'object' &&
          'sessionId' in state &&
          state.sessionId === sessionId
        );
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
        throw error;
      }
    },
    getCwd: async (sessionId) => {
      const path = statePath(directory, sessionId);
      if (path === undefined) return undefined;
      try {
        const state: unknown = JSON.parse(await readFile(path, 'utf8'));
        return state !== null &&
          typeof state === 'object' &&
          'cwd' in state &&
          typeof state.cwd === 'string'
          ? state.cwd
          : undefined;
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
        throw error;
      }
    },
    clear: async (sessionId) => {
      const path = statePath(directory, sessionId);
      if (path === undefined) return;
      try {
        await unlink(path);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    },
  };
}

function statePath(directory: string, sessionId: string | undefined): string | undefined {
  if (sessionId === undefined || !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId)) return undefined;
  return join(directory, `feedback-loop-${sessionId}.json`);
}
