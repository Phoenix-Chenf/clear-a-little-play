import { PREVIOUS_LEVEL_BY_CURRENT, mappedCurrentLevel } from './campaign-map.js?v=5';

// Revision 5 moves the former hundredth board to thirty and adds harder later boards.
export const PROGRESS_REVISION = 5;
const retainedLevel = new Map(PREVIOUS_LEVEL_BY_CURRENT.map((previous, index) => [previous, index + 1]));

export function restoreProgress(saved, levelCount) {
  const revision = saved?.revision;
  const current = revision === PROGRESS_REVISION;
  let selected = Number.isInteger(saved?.level) ? saved.level : 1;
  if (revision === 4) {
    selected = mappedCurrentLevel(selected);
  } else if (revision === 3) {
    selected = mappedCurrentLevel(Math.max(1, Math.min(30, selected)));
  } else if (!current && selected >= 3) {
    selected = revision === 2 && selected >= 8 && selected <= 12
      ? mappedCurrentLevel(selected - 5) : 3;
  }
  const level = Math.max(1, Math.min(levelCount, selected));
  const completed = (Array.isArray(saved?.completed) ? saved.completed : [])
    .filter(number => Number.isInteger(number) && number >= 1)
    .map(number => {
      if (current) return number;
      if (revision === 4) return retainedLevel.get(number) ?? null;
      if (number <= 2 || (revision === 3 && number === 3)) return number;
      return revision === 2 && number === 8 ? 3 : null;
    })
    .filter(number => number !== null && number <= levelCount);
  return { level, completed: [...new Set(completed)], revision: PROGRESS_REVISION };
}
