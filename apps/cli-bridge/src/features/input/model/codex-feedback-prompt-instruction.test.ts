import { describe, expect, it } from 'vitest';

import {
  buildCodexFeedbackSubmissionInstruction,
  CODEX_FEEDBACK_SUBMISSION_INSTRUCTION,
} from './codex-feedback-prompt-instruction.js';

describe('Codex feedback submission instruction', () => {
  it('subagent 피드백이 비활성화되면 기본 feedback 지침만 반환한다', () => {
    expect(buildCodexFeedbackSubmissionInstruction(false)).toBe(
      CODEX_FEEDBACK_SUBMISSION_INSTRUCTION,
    );
  });

  it('모델 선택이 없으면 기본 subagent를 사용하도록 안내한다', () => {
    const instruction = buildCodexFeedbackSubmissionInstruction(true);

    expect(instruction).toContain('Use the default general-purpose subagent');
    expect(instruction).not.toContain('Spawn the subagent with model');
  });

  it('선택된 모델과 reasoning effort를 subagent 지침에 포함한다', () => {
    const instruction = buildCodexFeedbackSubmissionInstruction(true, {
      model: 'gpt-6.1-sol',
      reasoningEffort: 'high',
    });

    expect(instruction).toContain(
      'Spawn the subagent with model gpt-6.1-sol and reasoning effort high.',
    );
  });
});
