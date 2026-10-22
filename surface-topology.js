// Surface coordinates use CSS world axes: right, down, front.
export const FACE_BASES = Object.freeze({
  front: { normal: [0, 0, 1], right: [1, 0, 0], down: [0, 1, 0] },
  right: { normal: [1, 0, 0], right: [0, 0, -1], down: [0, 1, 0] },
  back: { normal: [0, 0, -1], right: [-1, 0, 0], down: [0, 1, 0] },
  left: { normal: [-1, 0, 0], right: [0, 0, 1], down: [0, 1, 0] },
  top: { normal: [0, -1, 0], right: [1, 0, 0], down: [0, 0, 1] },
  bottom: { normal: [0, 1, 0], right: [1, 0, 0], down: [0, 0, -1] },
});
const VECTORS = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
const OPPOSITE = { up: 'down', right: 'left', down: 'up', left: 'right' };
const topologyCache = new WeakMap();
const EPSILON = 1e-10;

export function surfaceKey(node) { return `${node.face}:${node.x},${node.y}`; }
export function pieceRoute(piece) {
  return piece.route ?? piece.cells.map(([x, y]) => ({ face: piece.face, x, y }));
}
function pointOnFace(face, svgX, svgY) {
  const { normal, right, down } = face.basis;
  return face.at.map((at, i) => at + normal[i] * .5 + right[i] * (svgX / face.size - .5) + down[i] * (svgY / face.size - .5));
}
function integerPoint(face, x, y) {
  const { normal, right, down } = face.basis, n = face.size;
  return face.at.map((at, i) => Math.round(2 * n * at + n * normal[i] + (2 * x - n) * right[i] + (2 * y - n) * down[i]));
}
function edgeKey(face, x, y, dir) {
  const endpoints = {
    up: [[x, y], [x + 1, y]], right: [[x + 1, y], [x + 1, y + 1]],
    down: [[x, y + 1], [x + 1, y + 1]], left: [[x, y], [x, y + 1]],
  }[dir].map(([px, py]) => integerPoint(face, px, py).join(','));
  return endpoints.sort().join('|');
}

export function surfaceTopology(board) {
  const cached = topologyCache.get(board.faces);
  if (cached && cached.cubes === board.cubes) return cached.topology;
  const cubes = board.cubes ?? [{ id: 'cube', at: [0, 0, 0] }];
  const cubeMap = new Map(cubes.map(cube => [cube.id, cube]));
  const faces = new Map(board.faces.map(face => {
    const side = face.side ?? face.id, cubeId = face.cubeId ?? cubes[0]?.id;
    const cube = cubeMap.get(cubeId), basis = FACE_BASES[side];
    if (!cube || !basis || !Number.isInteger(face.size) || face.size < 1) throw new RangeError(`Invalid surface patch ${face.id}`);
    return [face.id, { ...face, side, cubeId, at: cube.at, basis }];
  }));
  const nodes = new Map(), neighbors = new Map(), edges = new Map();
  for (const face of faces.values()) {
    for (let y = 0; y < face.size; y++) for (let x = 0; x < face.size; x++) {
      const node = { face: face.id, x, y }, key = surfaceKey(node), adjacent = {};
      nodes.set(key, node);
      neighbors.set(key, adjacent);
      for (const [dir, [dx, dy]] of Object.entries(VECTORS)) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < face.size && ny >= 0 && ny < face.size) {
          adjacent[dir] = { node: { face: face.id, x: nx, y: ny }, dir };
        } else {
          adjacent[dir] = null;
          const edge = edgeKey(face, x, y, dir), entries = edges.get(edge) ?? [];
          entries.push({ key, node, dir });
          edges.set(edge, entries);
        }
      }
    }
  }
  for (const entries of edges.values()) {
    if (entries.length > 2) throw new RangeError('Ambiguous non-manifold surface edge');
    if (entries.length !== 2) continue;
    const [a, b] = entries;
    neighbors.get(a.key)[a.dir] = { node: b.node, dir: OPPOSITE[b.dir] };
    neighbors.get(b.key)[b.dir] = { node: a.node, dir: OPPOSITE[a.dir] };
  }
  const topology = { faces, nodes, neighbors };
  topologyCache.set(board.faces, { cubes: board.cubes, topology });
  return topology;
}

export function worldPoint(board, faceId, svgX, svgY) {
  const face = surfaceTopology(board).faces.get(faceId);
  if (!face) throw new RangeError(`Unknown surface patch ${faceId}`);
  return pointOnFace(face, svgX, svgY);
}
export function stepSurface(board, node, dir) {
  return surfaceTopology(board).neighbors.get(surfaceKey(node))?.[dir] ?? null;
}
function coplanar(a, b) {
  return a.basis.normal.every((value, i) => value === b.basis.normal[i])
    && a.at.reduce((sum, value, i) => sum + value * a.basis.normal[i], 0) === b.at.reduce((sum, value, i) => sum + value * a.basis.normal[i], 0);
}
function forwardSteps(board, piece) {
  const topology = surfaceTopology(board), result = [], seen = new Set();
  let current = pieceRoute(piece).at(-1), dir = piece.dir;
  if (!current || !VECTORS[dir]) return result;
  seen.add(surfaceKey(current));
  while (true) {
    const next = topology.neighbors.get(surfaceKey(current))?.[dir];
    if (!next || !coplanar(topology.faces.get(current.face), topology.faces.get(next.node.face))) break;
    if (seen.has(surfaceKey(next.node))) break;
    result.push(next);
    seen.add(surfaceKey(next.node));
    current = next.node;
    dir = next.dir;
  }
  return result;
}
export function exitRay(board, piece) { return forwardSteps(board, piece).map(step => step.node); }

function directionBetween(board, a, b) {
  const neighbors = surfaceTopology(board).neighbors.get(surfaceKey(a));
  return Object.keys(VECTORS).find(dir => neighbors?.[dir] && surfaceKey(neighbors[dir].node) === surfaceKey(b));
}
function svgCenter(node) { return [node.x + .5, node.y + .5]; }
function shifted(point, dir, distance) { return point.map((value, i) => value + VECTORS[dir][i] * distance); }
function samePoint(a, b) { return Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON; }

export function routeSegments(board, piece, travel = 0) {
  const route = pieceRoute(piece);
  if (!route.length) return [];
  const advance = Number.isFinite(travel) ? Math.max(0, travel) : 0;
  const intervals = [];
  let length = 0;
  function append(face, from, to, distance, dir) {
    if (distance <= EPSILON) return;
    intervals.push({ face, from, to, start: length, end: length + distance, dir });
    length += distance;
  }
  function connect(a, b, dir, continued) {
    const from = svgCenter(a), to = svgCenter(b);
    if (a.face === b.face) append(a.face, from, to, 1, dir);
    else {
      append(a.face, from, shifted(from, dir, .5), .5, dir);
      append(b.face, shifted(to, OPPOSITE[continued], .5), to, .5, continued);
    }
  }
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], dir = directionBetween(board, a, b);
    if (!dir) throw new RangeError(`Disconnected piece route ${piece.id}`);
    connect(a, b, dir, stepSurface(board, a, dir).dir);
  }
  const bodyLength = length, end = bodyLength + advance;
  let head = route.at(-1), headDir = piece.dir;
  if (!VECTORS[headDir]) throw new RangeError(`Invalid piece direction ${piece.id}`);
  if (advance > 0) {
    for (const next of forwardSteps(board, piece)) {
      connect(head, next.node, headDir, next.dir);
      head = next.node;
      headDir = next.dir;
    }
    const center = svgCenter(head), boundary = shifted(center, headDir, .5);
    append(head.face, center, boundary, .5, headDir);
    const remaining = end - length;
    if (remaining > EPSILON) append(head.face, boundary, shifted(boundary, headDir, remaining), remaining, headDir);
  }
  const fragments = [];
  for (const interval of intervals) {
    const from = Math.max(advance, interval.start), to = Math.min(end, interval.end);
    if (to - from <= EPSILON) continue;
    const interpolate = position => interval.from.map((value, i) => value + (interval.to[i] - value) * (position - interval.start) / (interval.end - interval.start));
    const a = interpolate(from), b = interpolate(to), previous = fragments.at(-1);
    if (previous?.face === interval.face && samePoint(previous.points.at(-1), a)) {
      previous.points.push(b);
      previous.dir = interval.dir;
    } else fragments.push({ face: interval.face, points: [a, b], head: false, dir: interval.dir });
  }
  if (!fragments.length) {
    // Single-cell pieces have a zero-length body but still carry one head.
    let cursor = svgCenter(route.at(-1)), face = route.at(-1).face;
    for (const interval of intervals) {
      if (advance < interval.start - EPSILON || advance > interval.end + EPSILON) continue;
      cursor = interval.from.map((value, i) => value + (interval.to[i] - value) * (advance - interval.start) / (interval.end - interval.start));
      face = interval.face;
      headDir = interval.dir;
      break;
    }
    fragments.push({ face, points: [cursor], head: true, dir: headDir });
  } else {
    fragments.at(-1).head = true;
    if (advance === 0) fragments.at(-1).dir = piece.dir;
  }
  return fragments;
}
