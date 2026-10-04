# Classic Hamburger Recipe

This recipe makes four classic hamburgers. Each burger has a seared beef patty, fresh toppings, and a simple sauce. The instructions include ketchup as the sauce so the recipe and implementation example agree.

## Ingredients

- 500 g ground beef
- 4 hamburger buns
- 4 slices of cheddar cheese
- 1 tomato, sliced
- 4 lettuce leaves
- 1 small red onion, thinly sliced
- 4 tablespoons ketchup
- Salt and black pepper
- 1 tablespoon neutral oil

## Prepare the Patties

Divide the ground beef into four equal portions and shape them into patties slightly wider than the buns. Season both sides with salt and black pepper. Heat the oil in a skillet over medium-high heat. Cook the patties for about four minutes on each side, or until they reach the desired doneness. Add a slice of cheddar during the final minute so it melts over each patty.

## Toast the Buns

Cut the buns in half and toast the cut sides in the skillet until golden. Toasting keeps the buns from becoming soggy when the ketchup and patty juices are added.

## Assemble the Hamburgers

Spread one tablespoon of ketchup over the bottom half of each toasted bun. Add a lettuce leaf, a cheeseburger patty, two tomato slices, and a few rings of red onion. Finish with another small amount of ketchup if you like a saucier hamburger, then close it with the top half of the bun.

## Serving Notes

Serve the hamburgers while the patties are hot. Put extra ketchup on the table for anyone who wants more sauce. The ketchup gives the beef a familiar sweet and tangy flavor, while the lettuce and tomato keep each bite fresh.

## TypeScript Implementation Example

The following function describes the same assembly order for a simple recipe app. It records ketchup as the default sauce and keeps the ingredient list in one place.

```ts
type Hamburger = {
  bun: string;
  patty: string;
  toppings: string[];
  sauce: string;
};

const hamburgerIngredients = [
  'ground beef',
  'hamburger bun',
  'cheddar cheese',
  'lettuce',
  'tomato',
  'red onion',
  'ketchup',
];

function makeHamburger(): Hamburger {
  return {
    bun: 'toasted hamburger bun',
    patty: 'seared beef patty with melted cheddar',
    toppings: ['lettuce', 'tomato', 'red onion'],
    sauce: 'ketchup',
  };
}

console.log(`Serve the hamburger with ${makeHamburger().sauce}.`);
```

## Example Result

The recipe app returns a toasted hamburger bun with a seared beef patty, cheddar, lettuce, tomato, red onion, and ketchup.
