import { describe, expect, it } from 'vitest';

import { AttachmentTokenStore } from '../features/attachments/store/attachment-token.store.js';
import { SessionStore } from '../features/session/session.store.js';
import type { AttachmentStore, LocalBridgeServerOptions, TemplateStore } from '../shared/types.js';
import { createBridgeNestApplication } from './create-bridge-nest-application.js';
import { ATTACHMENT_STORE, BRIDGE_OPTIONS, ON_PROMPT, TEMPLATE_STORE } from './tokens.js';

function createOptions(
  overrides: Partial<LocalBridgeServerOptions> = {},
): LocalBridgeServerOptions {
  return { onPrompt: async () => undefined, ...overrides };
}

describe('Nest 브리지 앱 기반', () => {
  it('HTTP 요청을 받기 시작하지 않고 Express 앱을 초기화한다', async () => {
    const application = await createBridgeNestApplication(createOptions());

    try {
      expect(application.getHttpAdapter().getType()).toBe('express');
      expect(application.getHttpServer().listening).toBe(false);
    } finally {
      await application.close();
    }
  });

  it('필수 값을 주입하고 선택적 저장소만 제공된 경우 등록한다', async () => {
    const templateStore: TemplateStore = {
      list: async () => [],
      save: async () => [],
      delete: async () => [],
    };
    const attachmentStore: AttachmentStore = {
      save: async () => 'id',
      read: async () => undefined,
      hasSceneData: async () => false,
      delete: async () => false,
    };
    const options = createOptions({ templateStore, attachmentStore });
    const application = await createBridgeNestApplication(options);

    try {
      expect(application.get(BRIDGE_OPTIONS, { strict: false })).toBe(options);
      expect(application.get(ON_PROMPT, { strict: false })).toBe(options.onPrompt);
      expect(application.get(TEMPLATE_STORE, { strict: false })).toBe(templateStore);
      expect(application.get(ATTACHMENT_STORE, { strict: false })).toBe(attachmentStore);
    } finally {
      await application.close();
    }
  });

  it('저장소가 전달되지 않으면 저장소 프로바이더를 만들지 않는다', async () => {
    const application = await createBridgeNestApplication(createOptions());

    try {
      expect(() => application.get(TEMPLATE_STORE, { strict: false })).toThrow();
      expect(() => application.get(ATTACHMENT_STORE, { strict: false })).toThrow();
    } finally {
      await application.close();
    }
  });

  it('세션과 첨부 토큰 저장소를 앱 인스턴스마다 분리한다', async () => {
    const first = await createBridgeNestApplication(createOptions());
    const second = await createBridgeNestApplication(createOptions());

    try {
      const firstSessions = first.get(SessionStore, { strict: false });
      const secondSessions = second.get(SessionStore, { strict: false });
      const session = firstSessions.create();
      expect(secondSessions.get(session.id)).toBeUndefined();

      const firstAttachmentTokens = first.get(AttachmentTokenStore, { strict: false });
      const secondAttachmentTokens = second.get(AttachmentTokenStore, { strict: false });
      firstAttachmentTokens.set(session.id, 'first-token');
      expect(secondAttachmentTokens.get(session.id)).toBeUndefined();
      expect(firstAttachmentTokens.delete(session.id)).toBe(true);
      expect(firstAttachmentTokens.get(session.id)).toBeUndefined();
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});
