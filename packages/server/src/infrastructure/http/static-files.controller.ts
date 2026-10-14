import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { BRIDGE_OPTIONS } from '../../runtime/tokens.js';
import type { LocalBridgeServerOptions } from '../../shared/types.js';
import { serveStatic } from './static-files.js';

@Controller()
export class StaticFilesController {
  public constructor(@Inject(BRIDGE_OPTIONS) private readonly options: LocalBridgeServerOptions) {}

  @All('{*path}')
  public async serve(
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await serveStatic(request, response, this.options.staticDir);
  }
}
