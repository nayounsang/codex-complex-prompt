import { Inject, Injectable } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { BRIDGE_OPTIONS } from '../../runtime/tokens.js';
import type { LocalBridgeServerOptions } from '../../shared/types.js';
import { serveStatic } from './static-files.utils.js';

@Injectable()
export class StaticFilesService {
  public constructor(@Inject(BRIDGE_OPTIONS) private readonly options: LocalBridgeServerOptions) {}

  public serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    return serveStatic(request, response, this.options.staticDir);
  }
}
