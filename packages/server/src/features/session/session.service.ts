import { Inject, Injectable } from '@nestjs/common';

import { SessionStore } from './session.store.js';
import type { SessionEntity } from './entities/session.entity.js';

@Injectable()
export class SessionService {
  public constructor(@Inject(SessionStore) private readonly sessionStore: SessionStore) {}

  public create(): SessionEntity {
    return this.sessionStore.create();
  }

  public authenticate(token: string): SessionEntity | undefined {
    return this.sessionStore.authenticate(token);
  }
}
