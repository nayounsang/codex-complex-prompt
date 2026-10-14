import 'reflect-metadata';

import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';

import { AttachmentTokenStore } from '../features/attachments/attachment-token-store.js';
import { AttachmentModule } from '../features/attachments/attachment.module.js';
import { InputModule } from '../features/input/input.module.js';
import { SessionStore } from '../features/session/storage/session-store.js';
import { SessionModule } from '../features/session/session.module.js';
import { TemplateModule } from '../features/templates/template.module.js';
import { StaticFilesModule } from '../infrastructure/http/static-files.module.js';
import type { LocalBridgeServerOptions } from '../shared/types.js';
import { ATTACHMENT_STORE, BRIDGE_OPTIONS, ON_PROMPT, TEMPLATE_STORE } from './tokens.js';

@Global()
@Module({
  imports: [AttachmentModule, InputModule, TemplateModule, SessionModule, StaticFilesModule],
})
export class BridgeServerModule {
  public static register(options: LocalBridgeServerOptions): DynamicModule {
    const providers: Provider[] = [
      { provide: BRIDGE_OPTIONS, useValue: options },
      { provide: ON_PROMPT, useValue: options.onPrompt },
      {
        provide: SessionStore,
        useFactory: (bridgeOptions: LocalBridgeServerOptions) => new SessionStore(bridgeOptions),
        inject: [BRIDGE_OPTIONS],
      },
      { provide: AttachmentTokenStore, useClass: AttachmentTokenStore },
    ];
    const exports: (symbol | typeof SessionStore | typeof AttachmentTokenStore)[] = [
      BRIDGE_OPTIONS,
      ON_PROMPT,
      SessionStore,
      AttachmentTokenStore,
    ];

    if (options.templateStore !== undefined) {
      providers.push({ provide: TEMPLATE_STORE, useValue: options.templateStore });
      exports.push(TEMPLATE_STORE);
    }
    if (options.attachmentStore !== undefined) {
      providers.push({ provide: ATTACHMENT_STORE, useValue: options.attachmentStore });
      exports.push(ATTACHMENT_STORE);
    }

    return { module: BridgeServerModule, global: true, providers, exports };
  }
}
