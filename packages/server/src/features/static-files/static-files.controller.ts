import { All, Controller, Inject, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { StaticFilesService } from './static-files.service.js';

@Controller()
export class StaticFilesController {
  public constructor(
    @Inject(StaticFilesService) private readonly staticFilesService: StaticFilesService,
  ) {}

  @All('{*path}')
  public async serve(
    @Req() request: IncomingMessage,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.staticFilesService.serve(request, response);
  }
}
