import { Module } from '@nestjs/common';

import { AttachmentModule } from '../attachments/attachment.module.js';
import { InputModule } from '../input/input.module.js';
import { TemplateModule } from '../templates/template.module.js';
import type { LocalBridgeServerOptions } from '../../shared/types.js';
import { BRIDGE_OPTIONS } from '../../runtime/tokens.js';
import { SessionWebSocketGateway } from './session-websocket.gateway.js';
import { SessionStore } from './session.store.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [AttachmentModule, InputModule, TemplateModule],
  providers: [
    {
      provide: SessionStore,
      useFactory: (options: LocalBridgeServerOptions) => new SessionStore(options),
      inject: [BRIDGE_OPTIONS],
    },
    SessionService,
    SessionWebSocketGateway,
  ],
  exports: [SessionStore, SessionService],
})
export class SessionModule {}
