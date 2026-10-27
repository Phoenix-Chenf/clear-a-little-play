import { restoreCubeProgress } from './cube-progress.js?v=18';
import { restorePlayHistory } from './play-history.js?v=2';
import { boardFingerprint, createSession, restoreSession } from './play-session.js?v=1';
import { createColumnTrialLevel } from './column-trial-levels.js?v=1';
import { createCubeLevel, tryCubeMove } from './cube-engine.js?v=20';

// The original data stay at their old storage keys, including the old sessions.
export const REPLACED_COLUMN_LEVELS = Object.freeze([
  12, 14, 17, 19, 23, 27,
  ...Array.from({ length: 68 }, (_, index) => index + 33).filter(level => [3, 5, 8, 0].includes(level % 10)),
]);
const replaced = new Set(REPLACED_COLUMN_LEVELS);
const trialLevels = [12, 14, 17, 19];
export const isReplacedColumnLevel = level => replaced.has(level);

function trialMatchesCampaign(trial, board) {
  return boardFingerprint({ ...board, id: trial.id }) === boardFingerprint(trial);
}

export function migrateColumnCampaign(oldProgress, oldHistory, trialProgress = null, trialHistory = null) {
  const progress = restoreCubeProgress(oldProgress);
  const history = restorePlayHistory(oldHistory);
  progress.completed = progress.completed.filter(level => !replaced.has(level));
  for (const level of REPLACED_COLUMN_LEVELS) delete history.times.cube[level];
  const completed = trialProgress?.revision === 1 && Array.isArray(trialProgress.completed) ? trialProgress.completed : [];
  const oldTrialHistory = restorePlayHistory(trialHistory);
  const trialRecords = oldTrialHistory.times.cube;
  history.guides.cube ||= oldTrialHistory.guides.cube;
  for (const [index, level] of trialLevels.entries()) {
    const number = index + 1, record = trialRecords[number];
    if (!completed.includes(number) && !record) continue;
    const trial = createColumnTrialLevel(number), board = createCubeLevel(level);
    if (!trialMatchesCampaign(trial, board)) continue;
    if (completed.includes(number)) progress.completed.push(level);
    if (record) history.times.cube[level] = record;
  }
  return { progress, history };
}

export const columnCampaignSessionKey = level => `clear-a-little-column100-session-v1-${level}`;

export function readColumnCampaignSession(storage, level, initial, tryMove) {
  const current = storage.getItem(columnCampaignSessionKey(level));
  const decode = text => {
    try { return restoreSession(initial, JSON.parse(text), tryMove); } catch { return null; }
  };
  if (current !== null) {
    const session = decode(current);
    return { source: session ? 'current' : 'invalid', session };
  }
  const trialIndex = trialLevels.indexOf(level);
  if (trialIndex >= 0) {
    const trialRaw = storage.getItem(`clear-a-little-session-v1-cube-columns-${trialIndex + 1}`);
    if (trialRaw !== null) {
      const trial = createColumnTrialLevel(trialIndex + 1);
      if (trialMatchesCampaign(trial, initial)) {
        let previous;
        try { previous = restoreSession(trial, JSON.parse(trialRaw), tryCubeMove); } catch {}
        if (previous) {
          const updated = createSession(initial, { moves: previous.moves, elapsedMs: previous.elapsedMs, hintUses: previous.hintUses });
          const session = updated && restoreSession(initial, updated, tryMove);
          if (session) return { source: 'trial', session };
        }
      }
    }
  }
  const legacy = storage.getItem(`clear-a-little-session-v1-cube-${level}`);
  if (legacy === null) return { source: 'none', session: null };
  if (isReplacedColumnLevel(level)) return { source: 'replaced', session: null };
  const session = decode(legacy);
  return { source: session ? 'legacy' : 'invalid', session };
}
