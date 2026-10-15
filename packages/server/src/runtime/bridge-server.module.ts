import 'reflect-metadata';

import { Module, type DynamicModule } from '@nestjs/common';

import { AttachmentModule } from '../features/attachments/attachment.module.js';
import { InputModule } from '../features/input/input.module.js';
import { SessionModule } from '../features/session/session.module.js';
import { TemplateModule } from '../features/templates/template.module.js';
import { StaticFilesModule } from '../features/static-files/static-files.module.js';
import type { LocalBridgeServerOptions } from '../shared/types.js';
import { BridgeConfigModule } from './bridge-config.module.js';

@Module({})
export class BridgeServerModule {
  public static register(options: LocalBridgeServerOptions): DynamicModule {
    return {
      module: BridgeServerModule,
      imports: [
        BridgeConfigModule.register(options),
        AttachmentModule,
        InputModule,
        TemplateModule,
        SessionModule,
        StaticFilesModule,
      ],
    };
  }
}
