import { LEVELS } from './levels.js?v=5';
import { SEARCH_LEVELS } from './search-levels.js?v=1';

export const LEVEL_COUNT = 100;
export const SEARCH_LEVEL_COUNT = 8;

const DIRECTIONS = {
  up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0],
};
function copyBoard(board) {
  return {
    ...board,
    pieces: board.pieces.map((piece) => ({
      ...piece, cells: piece.cells.map((cell) => [...cell]),
    })),
  };
}

export function createLevel(levelNumber) {
  if (!Number.isInteger(levelNumber) || levelNumber < 1 || levelNumber > LEVEL_COUNT) {
    throw new RangeError(`Level must be an integer from 1 to ${LEVEL_COUNT}`);
  }
  return copyBoard(LEVELS[levelNumber - 1]);
}

export function createSearchLevel(levelNumber) {
  if (!Number.isInteger(levelNumber) || levelNumber < 1 || levelNumber > SEARCH_LEVEL_COUNT) {
    throw new RangeError(`Search level must be an integer from 1 to ${SEARCH_LEVEL_COUNT}`);
  }
  return copyBoard(SEARCH_LEVELS[levelNumber - 1]);
}

function occupancyFor(board) {
  const occupancy = new Map();
  for (const piece of board.pieces) for (const [x, y] of piece.cells) occupancy.set(y * board.size + x, piece.id);
  return occupancy;
}

function blockingPiece(board, moving, occupancy = occupancyFor(board)) {
  const [dx, dy] = DIRECTIONS[moving.dir];
  const [hx, hy] = moving.cells[moving.cells.length - 1];
  for (let x = hx + dx, y = hy + dy; x >= 0 && y >= 0 && x < board.size && y < board.size; x += dx, y += dy) {
    const blocker = occupancy.get(y * board.size + x);
    if (blocker !== undefined) return blocker;
  }
  return null;
}

export function canExit(board, pieceId) {
  const piece = board.pieces.find((entry) => entry.id === pieceId);
  return Boolean(piece) && blockingPiece(board, piece) === null;
}

export function availableMoves(board) {
  const occupancy = occupancyFor(board);
  return board.pieces.filter((piece) => blockingPiece(board, piece, occupancy) === null).map((piece) => piece.id);
}

export function tryMove(board, pieceId) {
  const piece = board.pieces.find((entry) => entry.id === pieceId);
  if (!piece) return { board, moved: false, blockedBy: null };
  const blockedBy = blockingPiece(board, piece);
  if (blockedBy !== null) return { board, moved: false, blockedBy };
  return {
    board: { ...board, pieces: board.pieces.filter((entry) => entry.id !== pieceId) },
    moved: true,
    blockedBy: null,
  };
}

export function solveBoard(board) {
  let current = board;
  const solution = [];
  while (current.pieces.length) {
    const [nextId] = availableMoves(current);
    if (nextId === undefined) return null;
    solution.push(nextId);
    current = tryMove(current, nextId).board;
  }
  return solution;
}
