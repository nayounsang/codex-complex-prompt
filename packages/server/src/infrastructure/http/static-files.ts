import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, relative, resolve, sep } from 'node:path';

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function resolveStaticPath(staticDir: string, requestPath: string): string | undefined {
  const safeRoot = resolve(staticDir);
  const relativePath = requestPath === '/' ? 'index.html' : `.${requestPath}`;
  const candidate = resolve(safeRoot, relativePath);
  if (candidate !== safeRoot && !candidate.startsWith(`${safeRoot}${sep}`)) return undefined;
  return candidate;
}

function isWithinDirectory(directory: string, candidate: string): boolean {
  const relativePath = relative(directory, candidate);
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !relativePath.startsWith(sep)
  );
}

export async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  staticDir: string | undefined,
): Promise<void> {
  if (staticDir === undefined) {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Codex Complex Prompt bridge is running.');
    return;
  }
  const requestPath = new URL(request.url ?? '/', 'http://localhost').pathname;
  const candidate = resolveStaticPath(staticDir, requestPath);
  /* c8 ignore start -- the HTTP URL parser normalizes dot segments; the helper is tested directly. */
  if (candidate === undefined) {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }
  /* c8 ignore stop */
  let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const realStaticDir = await realpath(staticDir);
    const realCandidate = await realpath(candidate);
    if (!isWithinDirectory(realStaticDir, realCandidate))
      throw new Error('Outside static directory');

    const [verifiedPath, verifiedFile] = await Promise.all([
      realpath(realCandidate),
      stat(realCandidate),
    ]);
    if (
      verifiedPath !== realCandidate ||
      !isWithinDirectory(realStaticDir, verifiedPath) ||
      !verifiedFile.isFile()
    ) {
      throw new Error('Static file changed while validating');
    }

    fileHandle = await open(realCandidate, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedFile = await fileHandle.stat();
    if (
      !openedFile.isFile() ||
      openedFile.dev !== verifiedFile.dev ||
      openedFile.ino !== verifiedFile.ino
    ) {
      throw new Error('Static file changed while opening');
    }
    response.writeHead(200, {
      'content-type': mimeTypes[extname(realCandidate)] ?? 'application/octet-stream',
    });
    fileHandle.createReadStream().pipe(response);
  } catch {
    await fileHandle?.close().catch(() => undefined);
    response.writeHead(404);
    response.end('Not found');
  }
}
