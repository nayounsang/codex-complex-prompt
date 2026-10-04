import { outsideSelectionUnchanged } from '../criteria/outside-selection-unchanged.js';
import { selectedFeedbackApplied } from '../criteria/selected-feedback-applied.js';
import { similarContentPreserved } from '../criteria/similar-content-preserved.js';
import { configureCriterion, type ModelEvaluationCase } from '../types.js';

const selectionBeefFork: ModelEvaluationCase = {
  id: 'selection-beef-fork',
  title: 'Replace beef only in the selected recipe paragraph',
  fixture: new URL('../../fixtures/hamburger-recipe.md', import.meta.url),
  annotations: [
    {
      id: 'selection-beef-fork-feedback',
      scope: 'selection',
      start: 496,
      end: 868,
      quote:
        'Divide the ground beef into four equal portions and shape them into patties slightly wider than the buns. Season both sides with salt and black pepper. Heat the oil in a skillet over medium-high heat. Cook the patties for about four minutes on each side, or until they reach the desired doneness. Add a slice of cheddar during the final minute so it melts over each patty.',
      feedback: '이 문단의 beef를 fork로 바꿔줘.',
    },
  ],
  criteria: [
    configureCriterion(selectedFeedbackApplied, {
      selectionIndex: 0,
      mustNotContain: 'beef',
      mustContain: 'fork',
    }),
    configureCriterion(outsideSelectionUnchanged, {}),
    configureCriterion(similarContentPreserved, {
      passages: [
        'This recipe makes four classic hamburgers. Each burger has a seared beef patty, fresh toppings, and a simple sauce. The instructions include ketchup as the sauce so the recipe and implementation example agree.',
        '- 500 g ground beef',
        'The ketchup gives the beef a familiar sweet and tangy flavor, while the lettuce and tomato keep each bite fresh.',
        "  'ground beef',",
        "    patty: 'seared beef patty with melted cheddar',",
        'The recipe app returns a toasted hamburger bun with a seared beef patty, cheddar, lettuce, tomato, red onion, and ketchup.',
      ],
    }),
  ],
};

export { selectionBeefFork };
