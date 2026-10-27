const modes = ['classic', 'search', 'cube'];
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) => isObject(object) && Object.hasOwn(object, key);
const isDuration = value => Number.isSafeInteger(value) && value > 0;

export function restorePlayHistory(saved) {
  const restored = {
    revision: 1,
    guides: { classic: false, search: false, cube: false },
    times: { classic: {}, search: {}, cube: {} },
  };
  if (!own(saved, 'revision') || saved.revision !== 1) return restored;
  const guides = own(saved, 'guides') ? saved.guides : null;
  const times = own(saved, 'times') ? saved.times : null;
  for (const mode of modes) {
    restored.guides[mode] = own(guides, mode) && guides[mode] === true;
    if (!own(times, mode) || !isObject(times[mode])) continue;
    for (const [level, record] of Object.entries(times[mode])) {
      if (!/^(?:[1-9]\d?|100)$/.test(level)) continue;
      if (!own(record, 'latestMs') || !own(record, 'bestMs')) continue;
      if (!isDuration(record.latestMs) || !isDuration(record.bestMs) || record.bestMs > record.latestMs) continue;
      restored.times[mode][level] = { latestMs: record.latestMs, bestMs: record.bestMs };
      if (own(record, 'hintUses') && Number.isSafeInteger(record.hintUses) && record.hintUses >= 0) {
        restored.times[mode][level].hintUses = record.hintUses;
      }
      if (own(record, 'unassistedBestMs') && isDuration(record.unassistedBestMs) && record.unassistedBestMs >= record.bestMs) {
        restored.times[mode][level].unassistedBestMs = record.unassistedBestMs;
      }
    }
  }
  return restored;
}

export function recordCompletion(state, mode, level, elapsedMs, options = {}) {
  const restored = restorePlayHistory(state);
  if (!modes.includes(mode) || !Number.isInteger(level) || level < 1 || level > 100) return restored;
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return restored;
  const latestMs = Math.ceil(elapsedMs);
  if (!isDuration(latestMs)) return restored;
  const previous = restored.times[mode][level];
  restored.times[mode][level] = {
    latestMs,
    bestMs: previous ? Math.min(previous.bestMs, latestMs) : latestMs,
  };
  if (Number.isSafeInteger(options.hintUses) && options.hintUses >= 0) {
    const record = restored.times[mode][level];
    record.hintUses = options.hintUses;
    if (previous?.unassistedBestMs) record.unassistedBestMs = previous.unassistedBestMs;
    if (!options.hintUses) record.unassistedBestMs = Math.min(record.unassistedBestMs || latestMs, latestMs);
  }
  return restored;
}

export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '0:00';
  const seconds = Math.ceil(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remaining = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remaining}` : `${minutes}:${remaining}`;
}

export function createPlayTimer(now = () => performance.now()) {
  let accumulated = 0;
  let startedAt = now();
  let paused = false;
  let finished = false;

  function elapsed() {
    return paused || finished ? accumulated : accumulated + Math.max(0, now() - startedAt);
  }

  return {
    reset(elapsedMs = 0, completed = false) {
      accumulated = Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs <= Number.MAX_SAFE_INTEGER ? elapsedMs : 0;
      finished = Boolean(completed);
      startedAt = now();
    },
    setPaused(value) {
      const next = Boolean(value);
      if (next === paused) return;
      if (next && !finished) accumulated = elapsed();
      paused = next;
      if (!paused && !finished) startedAt = now();
    },
    complete() {
      if (!finished) {
        accumulated = elapsed();
        finished = true;
      }
      return accumulated;
    },
    resumeAfterUndo() {
      if (!finished) return;
      finished = false;
      if (!paused) startedAt = now();
    },
    elapsed,
    get finished() { return finished; },
  };
}
