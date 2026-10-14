import { selectionFeedbackScope } from './selection-feedback-scope.js';
import { selectionBeefFork } from './selection-beef-fork.js';
import { globalKetchupReplacement } from './global-ketchup-replacement.js';
import { headingSectionDecisions } from './heading-section-decisions.js';
import type { ModelEvaluationCase } from '../types.js';

export const evaluationCases: readonly ModelEvaluationCase[] = [
  selectionFeedbackScope,
  selectionBeefFork,
  globalKetchupReplacement,
  headingSectionDecisions,
];
