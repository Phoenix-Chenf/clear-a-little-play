const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isDuration = value => typeof value === 'number' && Number.isFinite(value)
  && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const isId = value => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

// Key ordering and decorative labels do not change a board's identity. Keep all
// other fields so new topology or movement-rule fields also invalidate a save.
export function boardFingerprint(initialBoard) {
  const source = JSON.stringify(initialBoard, (key, value) => {
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.keys(value).filter(name => name !== 'name')
      .sort().map(name => [name, value[name]]));
  });
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let index = 0; index < source.length; index++) {
    const unit = source.charCodeAt(index);
    first = Math.imul(first ^ unit, 0x01000193);
    second = Math.imul(second ^ unit, 0x85ebca6b);
  }
  const hex = value => (value >>> 0).toString(16).padStart(8, '0');
  return `board-v1-${source.length.toString(36)}-${hex(first)}${hex(second)}`;
}

function validActions(initialBoard, moves) {
  if (!Array.isArray(initialBoard?.pieces) || !Array.isArray(moves)
    || moves.length > initialBoard.pieces.length) return false;
  const ids = new Set(initialBoard.pieces.map(piece => piece.id));
  if (ids.size !== initialBoard.pieces.length) return false;
  const seen = new Set();
  for (const id of moves) {
    if (!isId(id) || !ids.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

export function createSession(initialBoard, { moves = [], elapsedMs = 0, hintUses = 0 } = {}) {
  if (!validActions(initialBoard, moves) || !isDuration(elapsedMs) || !isCount(hintUses)) return null;
  return {
    revision: 1,
    fingerprint: boardFingerprint(initialBoard),
    moves: [...moves],
    elapsedMs,
    hintUses,
  };
}

export function restoreSession(initialBoard, saved, tryMoveFn) {
  if (!isObject(saved) || typeof tryMoveFn !== 'function') return null;
  for (const key of ['revision', 'fingerprint', 'moves', 'elapsedMs', 'hintUses']) {
    if (!Object.hasOwn(saved, key)) return null;
  }
  if (saved.revision !== 1 || !isDuration(saved.elapsedMs) || !isCount(saved.hintUses)
    || !validActions(initialBoard, saved.moves)) return null;
  try {
    if (saved.fingerprint !== boardFingerprint(initialBoard)) return null;
    // Rebuild undo snapshots in memory only. Storage contains actions, never a
    // supplied board or history that could manufacture a completed position.
    let board = structuredClone(initialBoard);
    const history = [];
    for (const id of saved.moves) {
      const result = tryMoveFn(board, id);
      if (result?.moved !== true || !Array.isArray(result.board?.pieces)) return null;
      history.push(board);
      board = result.board;
    }
    return {
      board, history, moves: [...saved.moves], elapsedMs: saved.elapsedMs,
      hintUses: saved.hintUses, finished: board.pieces.length === 0,
    };
  } catch {
    return null;
  }
}
