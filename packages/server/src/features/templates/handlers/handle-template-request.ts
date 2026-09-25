import {
  encodeServerMessage,
  type PromptTemplate,
  type TemplateRequest,
  type ServerMessage,
} from '@codex-complex-prompt/protocol';
import type { WebSocket } from 'ws';

import type { TemplateStore } from '../../../shared/types.js';

export async function handleTemplateRequest(
  webSocket: WebSocket,
  request: TemplateRequest,
  templateStore: TemplateStore | undefined,
  templatesError: string | undefined,
): Promise<void> {
  if (templateStore === undefined) {
    send(webSocket, {
      type: 'template.result',
      requestId: request.requestId,
      status: 'failed',
      error: templatesError ?? 'Project templates are unavailable.',
    });
    return;
  }
  try {
    let templates: readonly PromptTemplate[];
    if (request.type === 'template.list') templates = await templateStore.list();
    else if (request.type === 'template.save')
      templates = await templateStore.save(request.template);
    else templates = await templateStore.delete(request.id);
    send(webSocket, {
      type: 'template.result',
      requestId: request.requestId,
      status: 'accepted',
      templates: [...templates],
    });
  } catch (error) {
    send(webSocket, {
      type: 'template.result',
      requestId: request.requestId,
      status: 'failed',
      error: templateStoreErrorMessage(error, 'Project templates could not be updated.'),
    });
  }
}

function send(webSocket: WebSocket, message: ServerMessage): void {
  if (webSocket.readyState === webSocket.OPEN) webSocket.send(encodeServerMessage(message));
}

export function templateStoreErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && 'code' in error && error.code === 'ERR_TEMPLATE_SYMLINK') {
    return 'Project template storage does not allow symbolic links. Replace them with regular files and directories.';
  }
  return fallback;
}
