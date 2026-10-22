import { stepSurface, pieceRoute } from './surface-topology.js';

// These are logical clearance cells on one continuous curved surface. Chart
// seams never end a ray. After these four cells the renderer lifts the line
// outward from the real sphere/cylinder instead of following another cell.
export function roundForwardSteps(board, piece) {
  const count = board.clearanceSteps ?? 4;
  if (count !== 4) throw new RangeError('Round boards require exactly four clearance cells');
  let node = pieceRoute(piece).at(-1), dir = piece.dir;
  const result = [];
  for (let i = 0; i < count; i++) {
    const next = stepSurface(board, node, dir);
    if (!next) throw new RangeError(`Open round chart at ${node?.face}`);
    result.push(next); ({ node, dir } = next);
  }
  return result;
}
export function roundExitRay(board, piece) { return roundForwardSteps(board, piece).map(step => step.node); }
