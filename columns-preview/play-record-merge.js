import { restorePlayHistory } from './play-history.js?v=2';

export function mergeCompleted(stored, incoming, max) {
  if (!Number.isInteger(max) || max < 1) return [];
  const valid = values => Array.isArray(values) ? values.filter(n => Number.isInteger(n) && n >= 1 && n <= max) : [];
  return [...new Set([...valid(stored), ...valid(incoming)])].sort((a, b) => a - b);
}

// An old tab must not replace records written by another tab while it was open.
export function mergePlayHistories(stored, incoming, { mode, completedLevel } = {}) {
  const previous = restorePlayHistory(stored), current = restorePlayHistory(incoming);
  const result = restorePlayHistory(null);
  for (const name of ['classic', 'search', 'cube']) {
    result.guides[name] = previous.guides[name] || current.guides[name];
    const levels = new Set([...Object.keys(previous.times[name]), ...Object.keys(current.times[name])]);
    for (const level of levels) {
      const old = previous.times[name][level], next = current.times[name][level];
      const latest = name === mode && Number(level) === completedLevel && next ? next : old || next;
      const record = { latestMs: latest.latestMs, bestMs: Math.min(old?.bestMs ?? Infinity, next?.bestMs ?? Infinity) };
      if (Number.isSafeInteger(latest.hintUses)) record.hintUses = latest.hintUses;
      const unassisted = Math.min(old?.unassistedBestMs ?? Infinity, next?.unassistedBestMs ?? Infinity);
      if (Number.isFinite(unassisted)) record.unassistedBestMs = unassisted;
      result.times[name][level] = record;
    }
  }
  return result;
}
