import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  encodeServerMessage,
  type PromptTemplate,
  type ServerMessage,
} from '@codex-complex-prompt/protocol';
import type { WebSocket } from 'ws';

import { BRIDGE_OPTIONS, TEMPLATE_STORE } from '../../runtime/tokens.js';
import type { LocalBridgeServerOptions, TemplateStore } from '../../shared/types.js';
import { TemplateRequestDtoSchema, type TemplateRequestDto } from './dto/template-request.dto.js';

@Injectable()
export class TemplateService {
  private readonly templateStore: TemplateStore | undefined;

  private readonly templatesError: string | undefined;

  public constructor(
    @Optional() @Inject(TEMPLATE_STORE) templateStore: TemplateStore | undefined,
    @Inject(BRIDGE_OPTIONS) options: LocalBridgeServerOptions,
  ) {
    this.templateStore = templateStore;
    this.templatesError = options.templatesError;
  }

  public async handleRequest(webSocket: WebSocket, request: TemplateRequestDto): Promise<void> {
    const dto = TemplateRequestDtoSchema.parse(request);
    if (this.templateStore === undefined) {
      send(webSocket, {
        type: 'template.result',
        requestId: dto.requestId,
        status: 'failed',
        error: this.templatesError ?? 'Project templates are unavailable.',
      });
      return;
    }
    try {
      let templates: readonly PromptTemplate[];
      if (dto.type === 'template.list') templates = await this.templateStore.list();
      else if (dto.type === 'template.save')
        templates = await this.templateStore.save(dto.template);
      else templates = await this.templateStore.delete(dto.id);
      send(webSocket, {
        type: 'template.result',
        requestId: dto.requestId,
        status: 'accepted',
        templates: [...templates],
      });
    } catch (error) {
      send(webSocket, {
        type: 'template.result',
        requestId: dto.requestId,
        status: 'failed',
        error: templateStoreErrorMessage(error, 'Project templates could not be updated.'),
      });
    }
  }

  public async getInitialState(): Promise<{
    readonly templates?: readonly PromptTemplate[];
    readonly templatesError?: string;
  }> {
    if (this.templateStore === undefined) {
      return this.templatesError === undefined ? {} : { templatesError: this.templatesError };
    }
    try {
      return { templates: await this.templateStore.list() };
    } catch (error) {
      return {
        templatesError: templateStoreErrorMessage(
          error,
          'Project templates could not be loaded from this directory.',
        ),
      };
    }
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
