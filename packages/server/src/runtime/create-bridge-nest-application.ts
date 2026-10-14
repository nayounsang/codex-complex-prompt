import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import type { LocalBridgeServerOptions } from '../shared/types.js';
import { BridgeServerModule } from './bridge-server.module.js';

export async function createBridgeNestApplication(
  options: LocalBridgeServerOptions,
): Promise<NestExpressApplication> {
  const application = await NestFactory.create<NestExpressApplication>(
    BridgeServerModule.register(options),
    { logger: false, bodyParser: false },
  );
  await application.init();
  return application;
}
