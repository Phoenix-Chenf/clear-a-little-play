// Entry n - 1 names the unchanged revision 4 board used by current level n.
export const PREVIOUS_LEVEL_BY_CURRENT = Object.freeze([
  1, 2, 3,
  ...Array.from({ length: 27 }, (_, index) => 4 + Math.round(index * 96 / 26)),
]);

// Resume at the next retained board so an omitted board never sends a player backwards.
export function mappedCurrentLevel(previousLevel) {
  const selected = Number.isInteger(previousLevel) ? Math.max(1, Math.min(100, previousLevel)) : 1;
  return PREVIOUS_LEVEL_BY_CURRENT.findIndex(number => number >= selected) + 1;
}
