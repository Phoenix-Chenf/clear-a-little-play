export const CUBE_PROGRESS_REVISION = 6;
const REPLACED_SHAPE_LEVELS = new Set([10, 11, 13, 15, 16, 18, 20, 22, 24, 26, 28, 30]);
const ROUND_LEVELS = new Set([12, 14, 17, 19, 23, 27]);

export function restoreCubeProgress(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved) || ![1, 2, 3, 4, 5, CUBE_PROGRESS_REVISION].includes(saved.revision)) {
    return { level: 1, completed: [], revision: CUBE_PROGRESS_REVISION };
  }
  const selected = Number.isInteger(saved.level) ? saved.level : 1;
  const maximum = saved.revision < 3 ? 8 : saved.revision < 6 ? 30 : 100;
  const level = Math.max(1, Math.min(maximum, selected));
  const completed = (Array.isArray(saved.completed) ? saved.completed : [])
    .filter(number => Number.isInteger(number) && number >= 1 && number <= (saved.revision === 1 ? 6 : maximum))
    .filter(number => saved.revision >= 4 || !REPLACED_SHAPE_LEVELS.has(number))
    .filter(number => saved.revision >= 5 || !ROUND_LEVELS.has(number));
  return { level, completed: [...new Set(completed)], revision: CUBE_PROGRESS_REVISION };
}
