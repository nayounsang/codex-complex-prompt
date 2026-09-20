import { randomUUID } from 'node:crypto';

export type ExecutionState = 'draft' | 'submitted' | 'accepted' | 'failed' | 'closed';

export interface PromptDraft {
  readonly id: string;
  readonly text: string;
  readonly createdAt: Date;
}

export interface Submission {
  readonly id: string;
  readonly draftId: string;
  readonly submittedAt: Date;
  readonly state: Extract<ExecutionState, 'submitted' | 'accepted' | 'failed'>;
  readonly error?: string;
}

export interface PromptSession {
  readonly draft: PromptDraft;
  readonly submissions: readonly Submission[];
  readonly state: ExecutionState;
}

export function createPromptDraft(
  text: string,
  now = new Date(),
  id: string = randomUUID(),
): PromptDraft {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error('A prompt draft cannot be empty.');
  return { id, text: trimmed, createdAt: now };
}

export function createPromptSession(draft: PromptDraft): PromptSession {
  return { draft, submissions: [], state: 'draft' };
}

export function recordSubmission(
  session: PromptSession,
  submission: Omit<Submission, 'draftId'> & { draftId?: string },
): PromptSession {
  if (session.submissions.some((item) => item.id === submission.id)) {
    throw new Error('A submission with this id already exists.');
  }
  if (submission.draftId !== undefined && submission.draftId !== session.draft.id) {
    throw new Error('The submission does not belong to this draft.');
  }
  return {
    ...session,
    submissions: [...session.submissions, { ...submission, draftId: session.draft.id }],
    state: submission.state,
  };
}

export function closePromptSession(session: PromptSession): PromptSession {
  return { ...session, state: 'closed' };
}
