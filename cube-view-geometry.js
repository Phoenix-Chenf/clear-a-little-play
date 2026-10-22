import { FACE_BASES } from './surface-topology.js?v=18';

export const FACE_ORDER = ['front', 'right', 'back', 'left', 'top', 'bottom'];
export const INITIAL_POSE = Object.freeze({ pitch: -22, yaw: -30 });

const NORMALS = {
  front: [0, 0, 1], right: [1, 0, 0], back: [0, 0, -1],
  left: [-1, 0, 0], top: [0, -1, 0], bottom: [0, 1, 0],
};
const POSES = {
  front: { pitch: 0, yaw: 0 }, right: { pitch: 0, yaw: -90 },
  back: { pitch: 0, yaw: -180 }, left: { pitch: 0, yaw: 90 },
  top: { pitch: -90, yaw: 0 }, bottom: { pitch: 90, yaw: 0 },
};
const radians = degrees => degrees * Math.PI / 180;

// CSS applies the rightmost rotation first: rotateX(pitch) rotateY(yaw).
export function faceNormal(face, { pitch, yaw }) {
  const [x, y, z] = NORMALS[face];
  const cy = Math.cos(radians(yaw)), sy = Math.sin(radians(yaw));
  const cp = Math.cos(radians(pitch)), sp = Math.sin(radians(pitch));
  const rotatedX = cy * x + sy * z, rotatedZ = -sy * x + cy * z;
  return [rotatedX, cp * y - sp * rotatedZ, sp * y + cp * rotatedZ];
}

// The cube's center recedes by half its edge, keeping a frontal face at z=0.
// Perspective can hide a grazing face even while its normal has positive z.
export function visibleFaces(pose, { edge = 1, perspective = 6 } = {}) {
  const threshold = (edge / 2) / (perspective + edge / 2);
  return FACE_ORDER.filter(face => faceNormal(face, pose)[2] > threshold + 1e-8);
}

export function poseForFace(face) { return { ...(POSES[face] || POSES.front) }; }

export function closestFace(pose) {
  return FACE_ORDER.reduce((best, face) => faceNormal(face, pose)[2] > faceNormal(best, pose)[2] ? face : best, 'front');
}

export function turnFace(face, step) {
  const index = Math.max(0, FACE_ORDER.indexOf(face));
  return FACE_ORDER[(index + (step < 0 ? -1 : 1) + FACE_ORDER.length) % FACE_ORDER.length];
}

export function startCubeGesture({ x, y, pointerId, pieceId = null, pose }) {
  return {
    startX: x, startY: y, pointerId, pieceId,
    startPose: { ...pose }, pose: { ...pose }, maxDistance: 0,
    dragging: false, canceled: false,
  };
}

export function updateCubeGesture(gesture, { x, y }, pointerCount = 1) {
  if (gesture.canceled || pointerCount !== 1) return { ...gesture, canceled: true };
  const dx = x - gesture.startX, dy = y - gesture.startY;
  const maxDistance = Math.max(gesture.maxDistance, Math.hypot(dx, dy));
  const dragging = maxDistance >= 7;
  const pose = dragging ? {
    pitch: Math.max(-90, Math.min(90, gesture.startPose.pitch - dy * .42)),
    yaw: gesture.startPose.yaw + dx * .45,
  } : gesture.pose;
  return { ...gesture, maxDistance, dragging, pose };
}

export function tappedPiece(gesture) {
  return gesture && !gesture.canceled && !gesture.dragging && gesture.maxDistance < 7 ? gesture.pieceId : null;
}

// Geometry below uses CSS world axes (+y down), shared by every assembled cube.
const cubesFor = board => board?.cubes?.length ? board.cubes : [{ id: 'cube', at: [0, 0, 0] }];
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);

// Build the opaque shell from whole planar regions. Adjacent squares cancel
// their shared boundary, so the painted object never exposes voxel joins.
export function surfaceSheets(board) {
  const cubes = cubesFor(board), cubeMap = new Map(cubes.map(cube => [cube.id, cube]));
  const sheets = new Map();
  for (const face of board.faces) {
    const side = face.side || face.id, basis = FACE_BASES[side];
    const at = (cubeMap.get(face.cubeId) || cubes[0]).at;
    const depth = dot(at, basis.normal) + .5, key = `${side}:${depth}`;
    if (!sheets.has(key)) sheets.set(key, { side, basis, depth, faceIds: [], squares: [] });
    const sheet = sheets.get(key);
    sheet.faceIds.push(face.id);
    sheet.squares.push([dot(at, basis.right) - .5, dot(at, basis.down) - .5]);
  }
  const pointKey = point => point.join(',');
  const edgeKey = (a, b) => `${pointKey(a)}|${pointKey(b)}`;
  return [...sheets.values()].map(({ side, basis, depth, faceIds, squares }) => {
    const min = [0, 1].map(axis => Math.min(...squares.map(square => square[axis])));
    const max = [0, 1].map(axis => Math.max(...squares.map(square => square[axis] + 1)));
    const edges = new Map();
    for (const [x, y] of squares) {
      const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[(i + 1) % 4], reverse = edgeKey(b, a);
        if (edges.has(reverse)) edges.delete(reverse);
        else edges.set(edgeKey(a, b), { a, b, direction: i });
      }
    }
    const outgoing = new Map();
    for (const edge of edges.values()) {
      const key = pointKey(edge.a);
      outgoing.set(key, [...(outgoing.get(key) || []), edge]);
    }
    const outlines = [];
    while (edges.size) {
      let edge = edges.values().next().value;
      const start = pointKey(edge.a), outline = [];
      do {
        outline.push(edge.a); edges.delete(edgeKey(edge.a, edge.b));
        if (pointKey(edge.b) === start) break;
        // At a corner touch, follow the tight right turn to keep independent
        // regions separate instead of crossing their outlines.
        const priority = [1, 0, 3, 2];
        edge = outgoing.get(pointKey(edge.b)).filter(next => edges.has(edgeKey(next.a, next.b)))
          .sort((a, b) => priority.indexOf((a.direction - edge.direction + 4) % 4) - priority.indexOf((b.direction - edge.direction + 4) % 4))[0];
      } while (edge);
      const corners = outline.filter((point, i) => {
        const previous = outline[(i + outline.length - 1) % outline.length], next = outline[(i + 1) % outline.length];
        return (point[0] - previous[0]) * (next[1] - point[1]) !== (point[1] - previous[1]) * (next[0] - point[0]);
      });
      outlines.push(corners.map(point => point.map((value, axis) => value - min[axis])));
    }
    const center = basis.normal.map((value, axis) => value * depth
      + basis.right[axis] * (min[0] + max[0]) / 2 + basis.down[axis] * (min[1] + max[1]) / 2);
    return { side, faceIds, center, width: max[0] - min[0], height: max[1] - min[1], outlines };
  });
}

export function sceneBounds(board) {
  const cubes = cubesFor(board);
  const min = [0, 1, 2].map(axis => Math.min(...cubes.map(cube => cube.at[axis] - .5)));
  const max = [0, 1, 2].map(axis => Math.max(...cubes.map(cube => cube.at[axis] + .5)));
  return { min, max, center: min.map((value, axis) => (value + max[axis]) / 2), span: min.map((value, axis) => max[axis] - value) };
}

export function initialPoseForBoard(board) {
  const { span } = sceneBounds(board);
  return { ...INITIAL_POSE, ...(span[1] === 1 && span[0] >= 3 && span[2] >= 3 ? { pitch: -58 } : {}) };
}

export function rotateWorldPoint([x, y, z], { pitch, yaw }) {
  const cy = Math.cos(radians(yaw)), sy = Math.sin(radians(yaw));
  const cp = Math.cos(radians(pitch)), sp = Math.sin(radians(pitch));
  const rx = cy * x + sy * z, rz = -sy * x + cy * z;
  return [rx, cp * y - sp * rz, sp * y + cp * rz];
}

function cameraWorld(pose, { edge = 1, perspective = 6, depth = edge / 2, focus = [0, 0, 0] } = {}) {
  const distance = (perspective + depth) / edge;
  const cp = Math.cos(radians(pose.pitch)), sp = Math.sin(radians(pose.pitch));
  const cy = Math.cos(radians(pose.yaw)), sy = Math.sin(radians(pose.yaw));
  return [-sy * cp * distance, sp * distance, cy * cp * distance].map((value, axis) => value + focus[axis]);
}

export function projectWorldPoint(point, pose, { edge = 1, perspective = 6, depth = edge / 2, focus = [0, 0, 0] } = {}) {
  const [x, y, z] = rotateWorldPoint(point.map((value, axis) => value - focus[axis]), pose);
  const scale = perspective / (perspective + depth - z * edge);
  return [x * edge * scale, y * edge * scale];
}

export function patchCenter(board, faceId) {
  const face = board?.faces?.find(item => item.id === faceId);
  const cube = cubesFor(board).find(item => item.id === face?.cubeId) || cubesFor(board)[0];
  const normal = NORMALS[face?.side || face?.id] || NORMALS.front;
  return cube.at.map((value, axis) => value + normal[axis] / 2);
}

export function sceneFrame(board, pose, { width = 320, height = 320, closeupFace = null } = {}) {
  const side = Math.min(width, height), perspective = side * 3.2;
  const bounds = sceneBounds(board);
  if (closeupFace) return { edge: side * .84, perspective, depth: 0, focus: patchCenter(board, closeupFace) };
  const frame = { edge: side * .53, perspective, depth: side * .53 / 2, focus: bounds.center };
  if (cubesFor(board).length === 1) return frame;
  const corners = cubesFor(board).flatMap(cube => [-.5, .5].flatMap(x => [-.5, .5].flatMap(y => [-.5, .5].map(z => cube.at.map((value, axis) => value + [x, y, z][axis])))));
  let lower = 0, upper = side;
  for (let iteration = 0; iteration < 32; iteration++) {
    const edge = (lower + upper) / 2, candidate = { ...frame, edge, depth: edge / 2 };
    const fits = corners.every(point => {
      const [x, y] = projectWorldPoint(point, pose, candidate);
      return Math.abs(x) <= width * .44 && Math.abs(y) <= height * .44;
    });
    if (fits) lower = edge; else upper = edge;
  }
  return { ...frame, edge: lower, depth: lower / 2 };
}

// A ray must pass through a voxel's interior to occlude a surface sample.
// Tangency along a shared edge does not make a visible seam inaccessible.
function crossesVoxel(start, end, at) {
  let near = 0, far = 1;
  for (let axis = 0; axis < 3; axis++) {
    const delta = end[axis] - start[axis], min = at[axis] - .5 + 1e-7, max = at[axis] + .5 - 1e-7;
    if (Math.abs(delta) < 1e-10) {
      if (start[axis] <= min || start[axis] >= max) return false;
    } else {
      const a = (min - start[axis]) / delta, b = (max - start[axis]) / delta;
      near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
      if (near >= far) return false;
    }
  }
  return far > 1e-7 && near < 1 - 1e-7;
}

export function surfacePointVisible(board, point, side, pose, view = {}) {
  const camera = cameraWorld(pose, view), normal = NORMALS[side];
  if (!normal || dot(normal, camera.map((value, axis) => value - point[axis])) <= 1e-7) return false;
  return !cubesFor(board).some(cube => crossesVoxel(point, camera, cube.at));
}

// Recover the point actually under a pointer, independently of SVG hit testing.
// A partly exposed route must not make its wall-covered remainder clickable.
export function surfacePointAtScreen(board, faceId, screen, pose, view = {}) {
  const face = board?.faces?.find(item => item.id === faceId), basis = FACE_BASES[face?.side || face?.id];
  if (!basis || screen?.length !== 2 || !screen.every(Number.isFinite)) return null;
  const { perspective = 6 } = view, cp = Math.cos(radians(pose.pitch)), sp = Math.sin(radians(pose.pitch));
  const cy = Math.cos(radians(pose.yaw)), sy = Math.sin(radians(pose.yaw));
  const [x, y, z] = [screen[0] / perspective, screen[1] / perspective, -1];
  const ry = cp * y + sp * z, rz = -sp * y + cp * z;
  const direction = [cy * x - sy * rz, ry, sy * x + cy * rz], camera = cameraWorld(pose, view), center = patchCenter(board, faceId);
  const denominator = dot(basis.normal, direction);
  if (Math.abs(denominator) < 1e-10) return null;
  const distance = dot(basis.normal, center.map((value, axis) => value - camera[axis])) / denominator;
  if (distance <= 0) return null;
  const point = camera.map((value, axis) => value + direction[axis] * distance), local = point.map((value, axis) => value - center[axis]);
  if (Math.abs(dot(local, basis.right)) > .5 + 1e-7 || Math.abs(dot(local, basis.down)) > .5 + 1e-7) return null;
  return point;
}

// Canonical views remain exact when clear. Inner walls of openings may require
// an oblique camera; test at most 121 nearby poses against every solid voxel.
export function findVisiblePatchPose(board, faceId, points, { width = 320, height = 320, closeup = false, preferredPose = null, search = true } = {}) {
  const face = board?.faces?.find(item => item.id === faceId), side = face?.side || face?.id;
  if (!FACE_BASES[side] || !points?.length) return null;
  const preferred = preferredPose || poseForFace(side);
  const candidates = [{ ...preferred }], seen = new Set([`${preferred.pitch},${preferred.yaw}`]);
  if (search) {
    const offsets = [0, 15, -15, 30, -30, 45, -45, 60, -60, 75, -75];
    const nearby = offsets.flatMap(pitch => offsets.map(yaw => ({ pitch, yaw })))
      .sort((a, b) => Math.hypot(a.pitch, a.yaw) - Math.hypot(b.pitch, b.yaw));
    for (const offset of nearby) {
      const pose = { pitch: Math.max(-90, Math.min(90, preferred.pitch + offset.pitch)), yaw: preferred.yaw + offset.yaw }, key = `${pose.pitch},${pose.yaw}`;
      if (!seen.has(key)) { seen.add(key); candidates.push(pose); }
    }
  }
  for (const pose of candidates) {
    const frame = sceneFrame(board, pose, { width, height, closeupFace: closeup ? faceId : null });
    if (points.every(point => {
      if (!surfacePointVisible(board, point, side, pose, frame)) return false;
      const rotated = rotateWorldPoint(point.map((value, axis) => value - frame.focus[axis]), pose);
      if (frame.perspective + frame.depth - rotated[2] * frame.edge <= 1e-7) return false;
      const [x, y] = projectWorldPoint(point, pose, frame);
      return Math.abs(x) <= width * .46 && Math.abs(y) <= height * .46;
    })) return { pose, frame };
  }
  return null;
}

export function patchFacing(board, faceId, pose, view = {}) {
  const face = board?.faces?.find(item => item.id === faceId);
  const normal = NORMALS[face?.side || face?.id];
  if (!normal) return false;
  const center = patchCenter(board, faceId), camera = cameraWorld(pose, view);
  return dot(normal, camera.map((value, axis) => value - center[axis])) > 1e-7;
}

export function closestPatch(board, pose, view = {}) {
  if (!board?.faces?.length) return closestFace(pose);
  let best = board.faces[0].id, bestScore = -Infinity;
  for (const face of board.faces) {
    const center = patchCenter(board, face.id), side = face.side || face.id;
    if (!surfacePointVisible(board, center, side, pose, view)) continue;
    const normalScore = faceNormal(side, pose)[2];
    const projected = projectWorldPoint(center, pose, view);
    const score = normalScore - Math.hypot(...projected) / ((view.edge || 1) * 20);
    if (score > bestScore) { best = face.id; bestScore = score; }
  }
  return best;
}

export function turnPatch(board, faceId, step) {
  const order = board?.faces?.map(face => face.id) || FACE_ORDER;
  if (!order.length) return 'front';
  const index = Math.max(0, order.indexOf(faceId));
  return order[(index + (step < 0 ? -1 : 1) + order.length) % order.length];
}
