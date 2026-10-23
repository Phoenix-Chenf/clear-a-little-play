export const SEARCH_PROGRESS_REVISION = 2;

export function restoreSearchProgress(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved) || ![1, SEARCH_PROGRESS_REVISION].includes(saved.revision)) {
    return { level: 1, completed: [], revision: SEARCH_PROGRESS_REVISION };
  }
  const selected = Number.isInteger(saved?.level) ? saved.level : 1;
  const maximum = saved.revision === 1 ? 8 : 100;
  const level = Math.max(1, Math.min(maximum, selected));
  const completed = (Array.isArray(saved?.completed) ? saved.completed : [])
    .filter(number => Number.isInteger(number) && number >= 1 && number <= maximum);
  return { level, completed: [...new Set(completed)], revision: SEARCH_PROGRESS_REVISION };
}
