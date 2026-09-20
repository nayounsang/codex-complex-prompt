import { describe, expect, it } from 'vitest';

import {
  closePromptSession,
  createPromptDraft,
  createPromptSession,
  recordSubmission,
} from './index.js';

describe('prompt 도메인 모델', () => {
  it('draft를 생성할 때 앞뒤 공백을 제거한다', () => {
    const draft = createPromptDraft(
      '  Improve this  ',
      new Date('2026-01-01T00:00:00.000Z'),
      'draft-1',
    );

    expect(draft.text).toBe('Improve this');
  });

  it('빈 draft 생성을 거부한다', () => {
    expect(() => createPromptDraft('   ')).toThrow('cannot be empty');
  });

  it('제출을 기록하면 session 상태를 accepted로 변경한다', () => {
    const draft = createPromptDraft(
      'Improve this',
      new Date('2026-01-01T00:00:00.000Z'),
      'draft-1',
    );
    const session = createPromptSession(draft);
    const next = recordSubmission(session, {
      id: 'submission-1',
      submittedAt: new Date('2026-01-01T00:01:00.000Z'),
      state: 'accepted',
    });

    expect(next.state).toBe('accepted');
    expect(next.submissions[0]?.draftId).toBe('draft-1');
  });

  it('동일한 submission ID의 중복 기록을 거부한다', () => {
    const session = createPromptSession(createPromptDraft('Prompt', new Date(), 'draft-2'));
    const submission = { id: 'same', submittedAt: new Date(), state: 'submitted' as const };
    const next = recordSubmission(session, submission);

    expect(() => recordSubmission(next, submission)).toThrow('already exists');
  });

  it('다른 draft에 속한 submission 기록을 거부한다', () => {
    const session = createPromptSession(createPromptDraft('Prompt', new Date(), 'draft-2'));

    expect(() =>
      recordSubmission(session, {
        id: 'submission-1',
        draftId: 'other-draft',
        submittedAt: new Date(),
        state: 'submitted',
      }),
    ).toThrow('does not belong');
  });

  it('session을 닫으면 상태를 closed로 변경한다', () => {
    const session = createPromptSession(createPromptDraft('Prompt', new Date(), 'draft-3'));

    expect(closePromptSession(session).state).toBe('closed');
  });
});
