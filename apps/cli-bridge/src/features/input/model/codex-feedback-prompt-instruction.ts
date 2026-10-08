import { FEEDBACK_EDIT_INSTRUCTION } from '@codex-complex-prompt/core/feedback';

export const CODEX_FEEDBACK_SUBMISSION_INSTRUCTION =
  FEEDBACK_EDIT_INSTRUCTION +
  'Do not call ExitPlanMode for this feedback submission; the browser editor will reopen so the user can continue review.\n\n';

export function buildCodexFeedbackSubmissionInstruction(sendFeedbackToSubagent: boolean): string {
  if (!sendFeedbackToSubagent) return CODEX_FEEDBACK_SUBMISSION_INSTRUCTION;
  return (
    'Use the default general-purpose subagent for this feedback submission. Start a new subagent for every submission and do not reuse an agent or reasoning context from an earlier feedback loop. Send the subagent the complete serialized feedback below, including every annotation and the full Current Markdown. Ask it to apply the feedback using the scope rules and return the complete updated Markdown only. Use that returned Markdown as the response; do not edit the document in this conversation.\n\n' +
    CODEX_FEEDBACK_SUBMISSION_INSTRUCTION
  );
}
