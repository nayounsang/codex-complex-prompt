import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';

import type { LocalBridgeServerOptions } from '../shared/types.js';
import { BridgeServerModule } from './bridge-server.module.js';

export async function createBridgeNestApplication(
  options: LocalBridgeServerOptions,
): Promise<NestExpressApplication> {
  validatePositiveInteger(options.maxConnections ?? 8, 'Maximum connections');
  validatePositiveInteger(options.promptTimeoutMs ?? 30_000, 'Prompt timeout');
  validatePositiveInteger(options.handshakeTimeoutMs ?? 5_000, 'Handshake timeout');

  const application = await NestFactory.create<NestExpressApplication>(
    BridgeServerModule.register(options),
    { logger: false, bodyParser: false },
  );
  try {
    application.useWebSocketAdapter(
      new WsAdapter(application, {
        messageParser: (data) => ({
          event: 'bridge.message',
          data: wsDataToString(data),
        }),
      }),
    );
    await application.init();
    return application;
  } catch (error) {
    await application.close();
    throw error;
  }
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function wsDataToString(data: string | Buffer | ArrayBuffer | Buffer[]): string {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  return Buffer.from(data).toString();
}
