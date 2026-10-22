export const SEARCH_PROGRESS_REVISION = 1;

export function restoreSearchProgress(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved) || saved.revision !== SEARCH_PROGRESS_REVISION) {
    return { level: 1, completed: [], revision: SEARCH_PROGRESS_REVISION };
  }
  const selected = Number.isInteger(saved?.level) ? saved.level : 1;
  const level = Math.max(1, Math.min(8, selected));
  const completed = (Array.isArray(saved?.completed) ? saved.completed : [])
    .filter(number => Number.isInteger(number) && number >= 1 && number <= 8);
  return { level, completed: [...new Set(completed)], revision: SEARCH_PROGRESS_REVISION };
}
