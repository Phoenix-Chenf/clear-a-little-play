import { restoreCubeProgress, CUBE_PROGRESS_REVISION } from './cube-progress.js?v=18';
import { mergeCompleted } from './play-record-merge.js?v=1';
import { columnCampaignSessionKey } from './column-campaign-migration.js?v=1';

export const FACE_PROGRESS_KEY = 'clear-a-little-cube-diverse-progress-v1';
export const FACE_HISTORY_KEY = 'clear-a-little-cube-diverse-history-v1';
export const FACE_VARIANT_KEY = 'clear-a-little-cube-face-variant-v1';
const within = (n, max) => Number.isInteger(n) && n >= 1 && n <= max;
const early = values => Array.isArray(values) ? values.filter(n => within(n, 3)) : [];
const later = values => Array.isArray(values) ? values.filter(n => within(n, 100) && n > 3) : [];
export function restoreFaceProgress(saved) {
  if (!saved || saved.revision !== 1) return { revision: 1, level: 1, completed: [] };
  return { revision: 1, level: within(saved.level, 100) ? saved.level : 1, completed: mergeCompleted([], early(saved.completed), 3) };
}
export function composeFaceProgress(shared, revised, variant) {
  const base = restoreCubeProgress(shared), fresh = restoreFaceProgress(revised);
  const completed = variant === 'legacy' ? base.completed : [...later(base.completed), ...fresh.completed];
  return { revision: CUBE_PROGRESS_REVISION, level: variant === 'legacy' || !revised ? base.level : fresh.level,
    completed: mergeCompleted([], completed, 100) };
}
export function splitFaceProgress(shared, revised, displayed, variant) {
  const base = restoreCubeProgress(shared), fresh = restoreFaceProgress(revised);
  const level = within(displayed?.level, 100) ? displayed.level : base.level;
  const visible = Array.isArray(displayed?.completed) ? displayed.completed : [];
  // Never put new boards' completion into the old/shared first-three records.
  const oldEarly = variant === 'legacy' ? mergeCompleted(early(base.completed), early(visible), 3) : early(base.completed);
  const oldLater = mergeCompleted(later(base.completed), later(visible), 100);
  const revisedEarly = variant === 'diverse' ? mergeCompleted(fresh.completed, early(visible), 3) : fresh.completed;
  return {
    shared: { revision: CUBE_PROGRESS_REVISION, level: variant === 'diverse' && level <= 3 ? base.level : level,
      completed: mergeCompleted(oldEarly, oldLater, 100) },
    revised: { revision: 1, level: variant === 'diverse' ? level : fresh.level, completed: revisedEarly },
  };
}
export function faceSessionKey(level, variant) {
  return variant === 'diverse' && within(level, 100)
    ? `clear-a-little-column100-diverse-session-v1-${level}` : columnCampaignSessionKey(level);
}

// Prefer a validated unfinished older board until the player chooses the new
// layout; an existing new-version session always keeps its own place.
export function variantForUnfinishedSession(variant, newSession, legacySession) {
  const hasProgress = legacySession?.moves?.length || legacySession?.elapsedMs > 0 || legacySession?.hintUses > 0;
  return variant === 'diverse' && !newSession && hasProgress && !legacySession.finished
    ? 'legacy' : variant;
}
