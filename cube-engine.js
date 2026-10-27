import { CUBE_LEVELS } from './cube-levels.js?v=1';
import { SURFACE_LEVELS } from './surface-levels.js?v=18';
import { SURFACE_CAMPAIGN_LEVELS } from './surface-campaign-levels.js?v=18';
import { COLUMN_REPLACEMENT_LEVELS } from './column-replacement-levels.js?v=1';
import { unpackCampaignBoard } from './campaign-codec.js?v=18';
import { exitRay, pieceRoute, surfaceKey } from './surface-topology.js?v=18';
import { roundExitRay } from './round-topology.js?v=18';

const replacements = new Map(COLUMN_REPLACEMENT_LEVELS.map(level => [level.id, level]));
const campaign = new Map([...SURFACE_CAMPAIGN_LEVELS, ...COLUMN_REPLACEMENT_LEVELS.filter(level => level.id > 30)].map(level => [level.id, level]));
export const CUBE_LEVEL_COUNT = CUBE_LEVELS.length + SURFACE_LEVELS.length + campaign.size;

export function createCubeLevel(levelNumber) {
  if (!Number.isInteger(levelNumber) || levelNumber < 1 || levelNumber > CUBE_LEVEL_COUNT) {
    throw new RangeError(`Cube level must be an integer from 1 to ${CUBE_LEVEL_COUNT}`);
  }
  if (replacements.has(levelNumber)) return unpackCampaignBoard(replacements.get(levelNumber));
  if (campaign.has(levelNumber)) return unpackCampaignBoard(campaign.get(levelNumber));
  const board = levelNumber <= 3 ? CUBE_LEVELS[levelNumber - 1] : SURFACE_LEVELS[levelNumber - 4];
  return {
    ...board,
    ...(board.shape ? { shape: { ...board.shape, scale: [...board.shape.scale] } } : {}),
    ...(board.cubes ? { cubes: board.cubes.map(cube => ({ ...cube, at: [...cube.at] })) } : {}),
    faces: board.faces.map(face => ({ ...face })),
    pieces: board.pieces.map(piece => ({
      ...piece,
      ...(piece.cells ? { cells: piece.cells.map(cell => [...cell]) } : {}),
      ...(piece.route ? { route: piece.route.map(node => ({ ...node })) } : {}),
    })),
  };
}

function occupancyFor(board) {
  const occupancy = new Map();
  for (const piece of board.pieces) {
    for (const node of pieceRoute(piece)) occupancy.set(surfaceKey(node), piece.id);
  }
  return occupancy;
}
function blockingPiece(board, moving, occupancy = occupancyFor(board)) {
  const ray = board.rules === 'round' ? roundExitRay(board, moving) : exitRay(board, moving);
  for (const node of ray) {
    const blocker = occupancy.get(surfaceKey(node));
    if (blocker !== undefined) return blocker;
  }
  return null;
}

export function availableCubeMoves(board) {
  const occupancy = occupancyFor(board);
  return board.pieces.filter(piece => blockingPiece(board, piece, occupancy) === null).map(piece => piece.id);
}

export function tryCubeMove(board, pieceId) {
  const piece = board.pieces.find(entry => entry.id === pieceId);
  if (!piece) return { board, moved: false, blockedBy: null };
  const blockedBy = blockingPiece(board, piece);
  if (blockedBy !== null) return { board, moved: false, blockedBy };
  return {
    board: { ...board, pieces: board.pieces.filter(entry => entry.id !== pieceId) },
    moved: true,
    blockedBy: null,
  };
}

export function solveCubeBoard(board) {
  let current = board;
  const solution = [];
  while (current.pieces.length) {
    const [nextId] = availableCubeMoves(current);
    if (nextId === undefined) return null;
    solution.push(nextId);
    current = tryCubeMove(current, nextId).board;
  }
  return solution;
}
