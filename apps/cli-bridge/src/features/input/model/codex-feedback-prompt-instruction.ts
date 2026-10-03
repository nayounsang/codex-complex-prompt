import { FEEDBACK_EDIT_INSTRUCTION } from '@codex-complex-prompt/core/feedback';

export const CODEX_FEEDBACK_SUBMISSION_INSTRUCTION =
  FEEDBACK_EDIT_INSTRUCTION +
  'Do not call ExitPlanMode for this feedback submission; the browser editor will reopen so the user can continue review.\n\n';
