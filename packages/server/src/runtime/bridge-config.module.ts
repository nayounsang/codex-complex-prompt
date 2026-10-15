import 'reflect-metadata';

import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';

import type { LocalBridgeServerOptions } from '../shared/types.js';
import { ATTACHMENT_STORE, BRIDGE_OPTIONS, ON_PROMPT, TEMPLATE_STORE } from './tokens.js';

@Global()
@Module({})
export class BridgeConfigModule {
  public static register(options: LocalBridgeServerOptions): DynamicModule {
    const providers: Provider[] = [
      { provide: BRIDGE_OPTIONS, useValue: options },
      { provide: ON_PROMPT, useValue: options.onPrompt },
    ];
    const exports: symbol[] = [BRIDGE_OPTIONS, ON_PROMPT];

    if (options.templateStore !== undefined) {
      providers.push({ provide: TEMPLATE_STORE, useValue: options.templateStore });
      exports.push(TEMPLATE_STORE);
    }
    if (options.attachmentStore !== undefined) {
      providers.push({ provide: ATTACHMENT_STORE, useValue: options.attachmentStore });
      exports.push(ATTACHMENT_STORE);
    }

    return { module: BridgeConfigModule, global: true, providers, exports };
  }
}
