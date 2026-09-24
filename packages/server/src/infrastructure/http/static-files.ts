import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

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
  try {
    const file = await stat(candidate);
    if (!file.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'content-type': mimeTypes[extname(candidate)] ?? 'application/octet-stream',
    });
    createReadStream(candidate).pipe(response);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}
