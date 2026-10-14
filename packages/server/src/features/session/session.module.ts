import { Module } from '@nestjs/common';

import { WebSocketLifecycleProvider } from './websocket-lifecycle.provider.js';

@Module({ providers: [WebSocketLifecycleProvider] })
export class SessionModule {}
